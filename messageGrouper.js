class MessageGrouper {
  constructor(aiProcessor, db) {
    this.aiProcessor = aiProcessor;
    this.db = db;
    this.oneSignalClient = null;
    this.messageBuffer = new Map(); // userId -> Map(chatId -> messages[])
    this.processingTimers = new Map(); // userId-chatId -> timer
    this.conversationHistory = new Map(); // userId-chatId -> actions history
    this.duplicateTracker = new Map(); // userId -> Set(action signatures)
    this.groupTopicTracker = new Map(); // chatId -> Map(topic -> {users, actions, lastUpdate})
    
    // Configuration
    this.GROUP_DELAY_MS = 15000; // 15 seconds delay to group messages
    this.MAX_GROUP_SIZE = 5; // Maximum messages in a group
    this.CONVERSATION_MEMORY_HOURS = 24; // How long to remember conversations
    this.DUPLICATE_SIMILARITY_THRESHOLD = 0.8; // Similarity threshold for duplicate detection
    this.GROUP_TOPIC_SIMILARITY_THRESHOLD = 0.7; // Similarity threshold for group topic detection
    this.GROUP_TOPIC_TIMEOUT_HOURS = 6; // How long to track group topics
  }

  setOneSignalClient(oneSignalClient) {
    this.oneSignalClient = oneSignalClient;
  }

  // Send OneSignal notification for new action
  async sendActionNotification(action, userId) {
    try {
      if (!this.oneSignalClient) {
        console.log('OneSignal client not available');
        return;
      }

      // Get user's OneSignal player ID from database
      const userResult = await this.db.query(
        'SELECT onesignal_player_id FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0 || !userResult.rows[0].onesignal_player_id) {
        console.log(`No OneSignal player ID found for user ${userId}`);
        return;
      }

      const playerId = userResult.rows[0].onesignal_player_id;
      
      const notification = {
        app_id: process.env.ONESIGNAL_APP_ID || '301d5b91-3055-4b33-8b34-902e885277f1',
        included_segments: ["All"], // Send to all subscribed users
        headings: {
          en: '🎯 New Action Created!'
        },
        contents: {
          en: `${action.type}: ${action.description}`
        },
        data: {
          actionId: action.actionId,
          actionType: action.type,
          userId: userId,
          targetPlayerId: playerId // Include for reference
        },
        url: 'juta-actions://action/' + action.actionId
      };

      const response = await this.oneSignalClient.createNotification(notification);
      console.log(`✅ OneSignal notification sent for action ${action.actionId}:`, response);
    } catch (error) {
      console.error(`❌ Failed to send OneSignal notification for action ${action.actionId}:`, error);
    }
  }

  async processMessage(messageData, userId, emitToUser) {
    const chatId = messageData.isGroup ? messageData.chatName : messageData.from;
    const bufferKey = `${userId}-${chatId}`;
    
    // Initialize buffer for this user-chat combination if needed
    if (!this.messageBuffer.has(userId)) {
      this.messageBuffer.set(userId, new Map());
    }
    if (!this.messageBuffer.get(userId).has(chatId)) {
      this.messageBuffer.get(userId).set(chatId, []);
    }
    
    // Add message to buffer
    const chatBuffer = this.messageBuffer.get(userId).get(chatId);
    chatBuffer.push(messageData);
    
    // Clear existing timer for this buffer
    if (this.processingTimers.has(bufferKey)) {
      clearTimeout(this.processingTimers.get(bufferKey));
    }
    
    // If buffer is full, process immediately
    if (chatBuffer.length >= this.MAX_GROUP_SIZE) {
      await this.processGroupedMessages(userId, chatId, emitToUser);
      return;
    }
    
    // Set timer to process after delay
    const timer = setTimeout(async () => {
      await this.processGroupedMessages(userId, chatId, emitToUser);
    }, this.GROUP_DELAY_MS);
    
    this.processingTimers.set(bufferKey, timer);
    
    console.log(`Message buffered for user ${userId}, chat ${chatId}. Buffer size: ${chatBuffer.length}`);
  }

  async processGroupedMessages(userId, chatId, emitToUser) {
    const bufferKey = `${userId}-${chatId}`;
    
    // Clear timer
    if (this.processingTimers.has(bufferKey)) {
      clearTimeout(this.processingTimers.get(bufferKey));
      this.processingTimers.delete(bufferKey);
    }
    
    // Get and clear buffer
    const chatBuffer = this.messageBuffer.get(userId)?.get(chatId);
    if (!chatBuffer || chatBuffer.length === 0) {
      return;
    }
    
    this.messageBuffer.get(userId).set(chatId, []);
    
    console.log(`Processing ${chatBuffer.length} grouped messages for user ${userId}, chat ${chatId}`);
    
    // Group messages by time window and sender
    const groupedMessages = this.groupMessagesByTimeAndSender(chatBuffer);
    console.log(`Grouped ${chatBuffer.length} messages into ${groupedMessages.length} groups for user ${userId}`);
    groupedMessages.forEach((group, index) => {
      console.log(`Group ${index + 1}: ${group.length} messages, fromMe: ${group[0].fromMe}, from: ${group[0].from}, fromName: ${group[0].fromName}`);
    });
    
    // Load conversation history
    const conversationHistory = await this.loadConversationHistory(userId, chatId);
    
    // Load group topic context if this is a group chat
    let groupTopicContext = null;
    if (chatBuffer[0]?.isGroup) {
      groupTopicContext = await this.loadGroupTopicContext(chatId);
    }
    
    // Process each message group
    for (const messageGroup of groupedMessages) {
      // Load conversation history specific to this sender
      // For group chats, use fromMe status to determine sender type
      const firstMessage = messageGroup[0];
      const senderId = firstMessage.isGroup ? 
        (firstMessage.fromMe ? 'me' : firstMessage.from) : 
        firstMessage.from;
      
      const senderConversationHistory = await this.loadConversationHistoryForSender(userId, chatId, senderId);
      await this.processMessageGroup(messageGroup, userId, chatId, senderConversationHistory, groupTopicContext, emitToUser);
    }
  }

  groupMessagesByTimeAndSender(messages) {
    const groups = [];
    let currentGroup = [];
    let currentSender = null;
    let currentTime = null;
    
    // Sort messages by timestamp
    messages.sort((a, b) => a.timestamp - b.timestamp);
    
    for (const message of messages) {
      const messageTime = message.timestamp * 1000; // Convert to milliseconds
      const timeDiff = currentTime ? messageTime - currentTime : 0;
      
      // For group chats, group by fromMe status instead of exact from field
      // This handles cases where WhatsApp uses different routing IDs for the same person
      const senderKey = message.isGroup ? 
        (message.fromMe ? 'me' : `other_${message.fromName}`) : 
        message.from;
      
      // Group if same sender and within 5 minutes
      if (currentSender === senderKey && timeDiff < 300000) { // 5 minutes
        currentGroup.push(message);
        currentTime = messageTime;
      } else {
        // Start new group
        if (currentGroup.length > 0) {
          groups.push([...currentGroup]);
        }
        currentGroup = [message];
        currentSender = senderKey;
        currentTime = messageTime;
      }
    }
    
    // Add final group
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
    
    return groups;
  }

  async processMessageGroup(messageGroup, userId, chatId, conversationHistory, groupTopicContext, emitToUser) {
    // Create combined message for AI processing
    const combinedMessage = this.createCombinedMessage(messageGroup);
    
    // Check if we already processed any of these messages
    const existingActions = await this.checkExistingActions(messageGroup, userId);
    if (existingActions.length > 0) {
      console.log(`Some messages in group already processed for user ${userId}, skipping group`);
      return;
    }
    
    // Check for group topic conflicts if this is a group chat
    let isGroupTopicDuplicate = false;
    if (combinedMessage.isGroup && groupTopicContext) {
      isGroupTopicDuplicate = await this.checkGroupTopicDuplicate(combinedMessage, groupTopicContext, userId);
    }
    
    if (isGroupTopicDuplicate) {
      console.log(`Group topic duplicate detected for user ${userId}, skipping processing`);
      return;
    }

    // Process with enhanced AI that includes conversation history and group context
    console.log(`Calling AI processor for user ${userId}, message: "${combinedMessage.body}"`);
    console.log(`Message details: fromMe=${combinedMessage.fromMe}, isGroup=${combinedMessage.isGroup}, chatName=${combinedMessage.chatName}, from=${combinedMessage.from}, fromName=${combinedMessage.fromName}`);
    console.log(`Conversation history length: ${conversationHistory.length}`);
    console.log(`Group topic context length: ${groupTopicContext ? groupTopicContext.length : 0}`);
    console.log(`Duplicate signatures count: ${this.getDuplicateActionSignatures(userId).size}`);
    
    const potentialActions = await this.aiProcessor.processMessageWithHistory(
      combinedMessage, 
      conversationHistory,
      this.getDuplicateActionSignatures(userId),
      groupTopicContext
    );
    
    console.log(`AI processor returned ${potentialActions ? potentialActions.length : 0} actions for user ${userId}`);
    if (potentialActions && potentialActions.length > 0) {
      // Filter out potential duplicates
      const filteredActions = this.filterDuplicateActions(potentialActions, userId, conversationHistory);
      
      for (const action of filteredActions) {
        await this.saveAndEmitAction(action, combinedMessage, userId, emitToUser);
      }
      
      // Update conversation history
      await this.updateConversationHistory(userId, chatId, filteredActions);
      
      // Update group topic tracker if this is a group chat
      if (combinedMessage.isGroup) {
        await this.updateGroupTopicTracker(chatId, combinedMessage, filteredActions, userId);
      }
    }
  }

  createCombinedMessage(messageGroup) {
    if (messageGroup.length === 1) {
      return messageGroup[0];
    }
    
    // Combine multiple messages into one coherent message
    const firstMessage = messageGroup[0];
    const combinedBody = messageGroup.map((msg, index) => {
      const timeStr = new Date(msg.timestamp * 1000).toLocaleTimeString();
      return `[${timeStr}] ${msg.body}`;
    }).join('\n');
    
    return {
      ...firstMessage,
      body: combinedBody,
      messageCount: messageGroup.length,
      isGroupedMessage: true,
      originalMessages: messageGroup
    };
  }

  async checkExistingActions(messageGroup, userId) {
    // Check if database connection is available
    if (!this.db || typeof this.db.query !== 'function') {
      console.warn('Database connection not available, skipping existing actions check');
      return [];
    }

    const messageIds = messageGroup.map(msg => msg.id);
    const placeholders = messageIds.map((_, index) => `$${index + 2}`).join(',');
    
    try {
      const existingActions = await this.db.query(
        `SELECT * FROM ai_actions 
         WHERE original_message->>'id' = ANY(ARRAY[${placeholders}]) 
         AND user_id = $1`,
        [userId, ...messageIds]
      );
      
      return existingActions.rows;
    } catch (error) {
      console.error('Error checking existing actions:', error);
      return [];
    }
  }

  async loadConversationHistory(userId, chatId) {
    // Check if database connection is available
    if (!this.db || typeof this.db.query !== 'function') {
      console.warn('Database connection not available, skipping conversation history load');
      return [];
    }

    const twentyFourHoursAgo = new Date(Date.now() - (this.CONVERSATION_MEMORY_HOURS * 60 * 60 * 1000));
    
    try {
      const historyResult = await this.db.query(
        `SELECT type, description, details, created_at, original_message
         FROM ai_actions 
         WHERE user_id = $1 
         AND (original_message->>'from' = $2 OR original_message->>'chatName' = $2)
         AND created_at > $3 
         ORDER BY created_at DESC 
         LIMIT 10`,
        [userId, chatId, twentyFourHoursAgo]
      );
      
      return historyResult.rows.map(row => ({
        type: row.type,
        description: row.description,
        details: row.details,
        createdAt: row.created_at,
        originalMessage: row.original_message
      }));
    } catch (error) {
      console.error('Error loading conversation history:', error);
      return [];
    }
  }

  async loadConversationHistoryForSender(userId, chatId, senderId) {
    // Check if database connection is available
    if (!this.db || typeof this.db.query !== 'function') {
      console.warn('Database connection not available, skipping conversation history load');
      return [];
    }

    const twentyFourHoursAgo = new Date(Date.now() - (this.CONVERSATION_MEMORY_HOURS * 60 * 60 * 1000));
    
    try {
      let query, params;
      
      if (senderId === 'me') {
        // For messages from the user (fromMe: true)
        query = `SELECT type, description, details, created_at, original_message
                 FROM ai_actions 
                 WHERE user_id = $1 
                 AND original_message->>'fromMe' = 'true'
                 AND original_message->>'chatName' = $2
                 AND created_at > $3 
                 ORDER BY created_at DESC 
                 LIMIT 5`;
        params = [userId, chatId, twentyFourHoursAgo];
      } else {
        // For messages from others (fromMe: false)
        query = `SELECT type, description, details, created_at, original_message
                 FROM ai_actions 
                 WHERE user_id = $1 
                 AND original_message->>'fromMe' = 'false'
                 AND original_message->>'chatName' = $2
                 AND created_at > $3 
                 ORDER BY created_at DESC 
                 LIMIT 5`;
        params = [userId, chatId, twentyFourHoursAgo];
      }
      
      const historyResult = await this.db.query(query, params);
      
      console.log(`Loaded ${historyResult.rows.length} conversation history items for sender ${senderId} in chat ${chatId}`);
      
      return historyResult.rows.map(row => ({
        type: row.type,
        description: row.description,
        details: row.details,
        createdAt: row.created_at,
        originalMessage: row.original_message
      }));
    } catch (error) {
      console.error('Error loading conversation history for sender:', error);
      return [];
    }
  }

  getDuplicateActionSignatures(userId) {
    return this.duplicateTracker.get(userId) || new Set();
  }

  filterDuplicateActions(actions, userId, conversationHistory) {
    const userDuplicates = this.duplicateTracker.get(userId) || new Set();
    const filtered = [];
    
    for (const action of actions) {
      // For outgoing messages (fromMe: true), be very permissive
      // Only filter exact duplicates within the last 5 minutes
      const isOutgoingMessage = action.originalMessage && action.originalMessage.fromMe === true;
      
      if (isOutgoingMessage) {
        // For outgoing messages, only check for very recent exact duplicates
        const signature = this.createActionSignature(action);
        const now = Date.now();
        const fiveMinutesAgo = now - (5 * 60 * 1000);
        
        // Check if this exact signature was created very recently
        let isRecentDuplicate = false;
        if (userDuplicates.has(signature)) {
          // For now, let's be very permissive and allow all outgoing messages
          console.log(`Allowing outgoing message despite recent signature: ${action.type} - ${action.description}`);
        }
        
        filtered.push(action);
        userDuplicates.add(signature);
        console.log(`Allowing outgoing message action: ${action.type} - ${action.description}`);
      } else {
        // For incoming messages, use normal duplicate detection
        const signature = this.createActionSignature(action);
        
        // Check against recent duplicates
        if (userDuplicates.has(signature)) {
          console.log(`Exact duplicate action filtered: ${signature}`);
          continue;
        }
        
        // Check history similarity for incoming messages
        const isSimilarToHistory = this.isSimilarToConversationHistory(action, conversationHistory);
        if (isSimilarToHistory) {
          console.log(`Similar action in history filtered: ${action.type} - ${action.description}`);
          continue;
        }
        
        filtered.push(action);
        userDuplicates.add(signature);
      }
    }
    
    // Store updated duplicates (keep only recent ones)
    this.duplicateTracker.set(userId, userDuplicates);
    
    return filtered;
  }

  createActionSignature(action) {
    // Create a signature based on action type, key phrases from description
    const descWords = action.description.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(' ')
      .filter(word => word.length > 2)
      .slice(0, 3)
      .sort()
      .join('-');
    
    return `${action.type}-${descWords}`;
  }

  isSimilarToConversationHistory(action, conversationHistory) {
    const recentActions = conversationHistory.slice(0, 5); // Check last 5 actions
    
    for (const historyAction of recentActions) {
      // Same type check
      if (historyAction.type === action.type) {
        // Check if the original messages are from the same sender
        const currentFromMe = action.originalMessage && action.originalMessage.fromMe;
        const historyFromMe = historyAction.originalMessage && historyAction.originalMessage.fromMe;
        
        // If both are from the same type of sender (both fromMe or both not fromMe)
        if (currentFromMe === historyFromMe) {
          // Simple similarity check based on common words
          const similarity = this.calculateStringSimilarity(
            action.description.toLowerCase(),
            historyAction.description.toLowerCase()
          );
          
          if (similarity > this.DUPLICATE_SIMILARITY_THRESHOLD) {
            console.log(`Similar action found from same sender type: ${action.type} - ${action.description}`);
            return true;
          }
        }
      }
    }
    
    return false;
  }

  calculateStringSimilarity(str1, str2) {
    const words1 = new Set(str1.split(' '));
    const words2 = new Set(str2.split(' '));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  async saveAndEmitAction(action, messageData, userId, emitToUser) {
    const actionId = `action_${userId}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    
    const actionWithId = {
      ...action,
      actionId,
      originalMessage: messageData,
      userId: userId
    };
    
    try {
      const actionDetails = {
        title: action.details?.title || action.description || `${action.type} Action`,
        content: action.details?.content || this.generateActionContent(action, messageData),
        datetime: action.details?.datetime || this.extractDatetime(messageData.body),
        priority: action.details?.priority || 'medium',
        category: action.details?.category || action.type || 'general',
        urgency_reason: action.details?.urgency_reason || 'Detected from message analysis',
        suggested_actions: action.details?.suggested_actions || ['Review and take action'],
        context: action.details?.context || (messageData.isGroupedMessage ? 'Grouped message analysis' : 'Single message analysis')
      };

      // Only save to database if connection is available
      if (this.db && typeof this.db.query === 'function') {
        await this.db.query(
          'INSERT INTO ai_actions (action_id, type, description, original_message, details, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
          [actionId, action.type, action.description, JSON.stringify(messageData), JSON.stringify(actionDetails), userId]
        );
      } else {
        console.warn('Database connection not available, action not saved to database');
      }
      
      // Send OneSignal notification
      await this.sendActionNotification(actionWithId, userId);
      
      // Send to frontend (this should work even without database)
      emitToUser(userId, 'newAction', {
        actionId: actionId,
        type: action.type,
        description: action.description,
        details: actionDetails,
        confidence: action.confidence || 0.8,
        originalMessage: {
          fromName: messageData.fromName,
          from: messageData.from,
          chatName: messageData.chatName,
          body: messageData.body,
          timestamp: messageData.timestamp,
          isGroup: messageData.isGroup || false,
          isGroupedMessage: messageData.isGroupedMessage || false,
          messageCount: messageData.messageCount || 1
        }
      });
      
      console.log(`Enhanced action detected and ${this.db ? 'saved' : 'processed'} for user ${userId}: ${action.type} - ${action.description} (ID: ${actionId})`);
    } catch (error) {
      console.error(`Error saving enhanced action to database for user ${userId}:`, error);
    }
  }

  async updateConversationHistory(userId, chatId, actions) {
    const conversationKey = `${userId}-${chatId}`;
    
    if (!this.conversationHistory.has(conversationKey)) {
      this.conversationHistory.set(conversationKey, []);
    }
    
    const history = this.conversationHistory.get(conversationKey);
    
    // Add new actions to history
    actions.forEach(action => {
      history.unshift({
        type: action.type,
        description: action.description,
        details: action.details,
        createdAt: new Date()
      });
    });
    
    // Keep only recent history
    history.splice(20); // Keep last 20 actions
    
    this.conversationHistory.set(conversationKey, history);
  }

  generateActionContent(action, messageData) {
    if (messageData.isGroupedMessage) {
      return `Grouped messages (${messageData.messageCount}) from ${messageData.fromName}: "${messageData.body}"`;
    }
    
    switch (action.type) {
      case 'event':
        return `Meeting request from ${messageData.fromName}: "${messageData.body}"`;
      case 'reminder':
        return `Reminder from ${messageData.fromName}: "${messageData.body}"`;
      case 'task':
        return `Task from ${messageData.fromName}: "${messageData.body}"`;
      default:
        return `${action.type} from ${messageData.fromName}: "${messageData.body}"`;
    }
  }

  extractDatetime(messageBody) {
    // Enhanced datetime extraction
    const timeRegex = /(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/g;
    const dateRegex = /(esok|tomorrow|today|hari ini|next week|minggu depan|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gi;
    
    const timeMatch = messageBody.match(timeRegex);
    const dateMatch = messageBody.match(dateRegex);
    
    if (timeMatch || dateMatch) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString();
    }
    
    return null;
  }

  async loadGroupTopicContext(chatId) {
    // Check if database connection is available
    if (!this.db || typeof this.db.query !== 'function') {
      console.warn('Database connection not available, skipping group topic context load');
      return [];
    }

    try {
      const sixHoursAgo = new Date(Date.now() - (this.GROUP_TOPIC_TIMEOUT_HOURS * 60 * 60 * 1000));
      
      const topicResult = await this.db.query(
        `SELECT type, description, details, original_message, user_id, created_at
         FROM ai_actions 
         WHERE original_message->>'chatName' = $1 
         AND original_message->>'isGroup' = 'true'
         AND created_at > $2 
         ORDER BY created_at DESC 
         LIMIT 15`,
        [chatId, sixHoursAgo]
      );
      
      // Group by topic/action type for analysis
      const topicMap = new Map();
      
      for (const row of topicResult.rows) {
        const actionKey = `${row.type}-${this.extractTopicKeywords(row.description).join('-')}`;
        
        if (!topicMap.has(actionKey)) {
          topicMap.set(actionKey, {
            type: row.type,
            description: row.description,
            users: new Set(),
            actions: [],
            lastUpdate: new Date(row.created_at)
          });
        }
        
        const topic = topicMap.get(actionKey);
        topic.users.add(row.user_id);
        topic.actions.push({
          description: row.description,
          details: row.details,
          userId: row.user_id,
          createdAt: row.created_at
        });
      }
      
      return Array.from(topicMap.values()).map(topic => ({
        ...topic,
        users: Array.from(topic.users)
      }));
      
    } catch (error) {
      console.error('Error loading group topic context:', error);
      return [];
    }
  }

  async checkGroupTopicDuplicate(messageData, groupTopicContext, userId) {
    const messageKeywords = this.extractTopicKeywords(messageData.body);
    
    for (const topic of groupTopicContext) {
      const topicKeywords = this.extractTopicKeywords(topic.description);
      
      // Calculate keyword overlap
      const overlap = this.calculateKeywordOverlap(messageKeywords, topicKeywords);
      
      if (overlap > this.GROUP_TOPIC_SIMILARITY_THRESHOLD) {
        // Check if this user already contributed to this topic
        if (topic.users.includes(userId)) {
          return true; // User already has action for this topic
        }
        
        // Check if multiple users already discussed this topic
        if (topic.users.length >= 2 && topic.actions.length >= 2) {
          const hoursSinceLastAction = (Date.now() - new Date(topic.lastUpdate).getTime()) / (1000 * 60 * 60);
          
          // If recent group discussion about same topic, likely duplicate
          if (hoursSinceLastAction < 2) {
            console.log(`Recent group discussion detected for topic: ${topic.type} - ${topic.description}`);
            return true;
          }
        }
      }
    }
    
    return false;
  }

  extractTopicKeywords(text) {
    // Extract meaningful keywords, excluding common words
    const commonWords = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'must', 'shall']);
    
    return text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !commonWords.has(word))
      .slice(0, 10); // Top 10 keywords
  }

  calculateKeywordOverlap(keywords1, keywords2) {
    if (keywords1.length === 0 || keywords2.length === 0) return 0;
    
    const set1 = new Set(keywords1);
    const set2 = new Set(keywords2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  async updateGroupTopicTracker(chatId, messageData, actions, userId) {
    if (!this.groupTopicTracker.has(chatId)) {
      this.groupTopicTracker.set(chatId, new Map());
    }
    
    const chatTopics = this.groupTopicTracker.get(chatId);
    
    for (const action of actions) {
      const topicKey = `${action.type}-${this.extractTopicKeywords(action.description).slice(0, 3).join('-')}`;
      
      if (!chatTopics.has(topicKey)) {
        chatTopics.set(topicKey, {
          users: new Set(),
          actions: [],
          lastUpdate: new Date(),
          type: action.type,
          description: action.description
        });
      }
      
      const topic = chatTopics.get(topicKey);
      topic.users.add(userId);
      topic.actions.push({
        userId,
        description: action.description,
        timestamp: new Date()
      });
      topic.lastUpdate = new Date();
    }
  }

  // Cleanup method to prevent memory leaks
  cleanup() {
    const now = Date.now();
    const cleanupThreshold = 60 * 60 * 1000; // 1 hour
    
    // Clean old buffers
    for (const [userId, chatMap] of this.messageBuffer.entries()) {
      for (const [chatId, messages] of chatMap.entries()) {
        if (messages.length > 0 && (now - messages[0].timestamp * 1000) > cleanupThreshold) {
          chatMap.delete(chatId);
        }
      }
      if (chatMap.size === 0) {
        this.messageBuffer.delete(userId);
      }
    }
    
    // Clean old conversation history
    for (const [key, history] of this.conversationHistory.entries()) {
      const filteredHistory = history.filter(item => 
        (now - new Date(item.createdAt).getTime()) < (this.CONVERSATION_MEMORY_HOURS * 60 * 60 * 1000)
      );
      this.conversationHistory.set(key, filteredHistory);
    }
    
    // Clean duplicate tracker (keep only recent signatures)
    for (const [userId, signatures] of this.duplicateTracker.entries()) {
      if (signatures.size > 50) { // Keep only 50 most recent
        const newSignatures = new Set(Array.from(signatures).slice(-30));
        this.duplicateTracker.set(userId, newSignatures);
      }
    }
    
    // Clean group topic tracker
    const topicCleanupThreshold = this.GROUP_TOPIC_TIMEOUT_HOURS * 60 * 60 * 1000;
    
    for (const [chatId, topicMap] of this.groupTopicTracker.entries()) {
      for (const [topicKey, topic] of topicMap.entries()) {
        if ((now - topic.lastUpdate.getTime()) > topicCleanupThreshold) {
          topicMap.delete(topicKey);
        }
      }
      if (topicMap.size === 0) {
        this.groupTopicTracker.delete(chatId);
      }
    }
  }
}

module.exports = MessageGrouper;