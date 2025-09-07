const OpenAI = require('openai');

class AIProcessor {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async processMessage(messageData) {
    return this.processMessageWithHistory(messageData, [], new Set());
  }

  async processMessageWithHistory(messageData, conversationHistory = [], duplicateSignatures = new Set(), groupTopicContext = null) {
    console.log(`AI Processor: Processing message "${messageData.body}" for user ${messageData.userId || 'unknown'}`);
    console.log(`AI Processor: fromMe=${messageData.fromMe}, conversationHistory=${conversationHistory.length}, groupTopicContext=${groupTopicContext ? groupTopicContext.length : 0}, duplicateSignatures=${duplicateSignatures.size}`);
    try {
      // Build conversation context
      let conversationContext = '';
      if (conversationHistory.length > 0) {
        console.log(`AI Processor: Conversation history items:`, conversationHistory.map(action => ({
          type: action.type,
          description: action.description,
          createdAt: action.createdAt
        })));
        conversationContext = `

RECENT CONVERSATION HISTORY (for context - only avoid creating identical actions):
${conversationHistory.slice(0, 5).map(action => 
  `- ${action.type}: ${action.description} (${new Date(action.createdAt).toLocaleDateString()})`
).join('\n')}

NOTE: If the current message is about a NEW or DIFFERENT task/commitment, create an action even if similar topics were discussed before.
`;
      }

      let duplicateContext = '';
      if (duplicateSignatures.size > 0) {
        duplicateContext = `

RECENT ACTION SIGNATURES TO AVOID DUPLICATING:
${Array.from(duplicateSignatures).slice(0, 10).join(', ')}
`;
      }

      let messageTypeContext = '';
      if (messageData.isGroupedMessage) {
        messageTypeContext = `

MESSAGE TYPE: This is a grouped message containing ${messageData.messageCount} consecutive messages from the same sender, combined for better context understanding.
`;
      }

      let groupTopicContext_str = '';
      if (groupTopicContext && groupTopicContext.length > 0 && messageData.isGroup) {
        groupTopicContext_str = `

GROUP TOPIC CONTEXT (Recent group discussions to avoid duplicating):
${groupTopicContext.slice(0, 3).map(topic => 
  `- ${topic.type}: "${topic.description}" (discussed by ${topic.users.length} users, last update: ${new Date(topic.lastUpdate).toLocaleDateString()})`
).join('\n')}

IMPORTANT: If this message is very similar to any of the above group topics, DO NOT create a duplicate action. Multiple users discussing the same topic should not generate multiple identical actions.
`;
      }

      const prompt = `
You are a selective personal assistant AI analyzing WhatsApp messages for TRULY actionable content. Only create actions for messages that require specific follow-up or action items.

ACTIONABLE CONTENT CRITERIA:
- Clear requests or tasks that need completion
- Specific deadlines, appointments, or time-sensitive items
- Problems that require solutions or troubleshooting
- Business matters requiring follow-up
- Learning opportunities with concrete next steps
- Administrative tasks with specific requirements
- Technical commitments or promises ("I'll get it running", "I'll fix this", "ill get it up and running")
- Development tasks or system work
- Any statement indicating future action or responsibility
- ANY promise or commitment about future work (even informal language)
- ANY mention of getting something "up and running", "working", "fixed", "deployed"
- ANY technical work commitment with time references ("by then", "next week", "soon")

NON-ACTIONABLE CONTENT (DO NOT CREATE ACTIONS FOR):
- Casual conversation, greetings, small talk
- General information sharing without requests
- Simple acknowledgments ("ok", "thanks", "got it")
- Social messages, jokes, memes
- Status updates without action requirements
- Questions that are rhetorical or conversational
- Messages that are purely informational
- Actions that are very similar to recent conversation history

Message details:
From: ${messageData.fromName} (${messageData.from})
${messageData.isGroup ? `Group: ${messageData.chatName}` : 'Private chat'}
Message: "${messageData.body}"
Timestamp: ${new Date(messageData.timestamp * 1000).toISOString()}
From Me: ${messageData.fromMe}${messageTypeContext}${conversationContext}${duplicateContext}${groupTopicContext_str}

IMPORTANT CONTEXT FOR ACTION DETECTION:
- If fromMe: true - Detect your own commitments, promises, and tasks (BE AGGRESSIVE - better to catch too many than miss important commitments)
- If fromMe: false - Only detect if the message is asking YOU to do something, not if others are talking about their own plans
- TECHNICAL COMMITMENTS: Always create actions for technical promises, even if similar topics were discussed before
- TIME-BASED COMMITMENTS: Always create actions for promises with time references ("by then", "next week", etc.)

Response format - JSON array of action objects:
{
  "type": "reminder|task|event|note|issue|follow_up|research|communication|creative|administrative|health|finance|learning|shopping|travel",
  "description": "Clear, actionable description",
  "details": {
    "title": "Concise title",
    "content": "Full context and details",
    "datetime": "ISO datetime if time-sensitive",
    "priority": "low|medium|high|urgent",
    "category": "specific category",
    "urgency_reason": "why this priority level",
    "suggested_actions": ["action1", "action2"],
    "context": "additional context"
  },
  "confidence": 0.0-1.0
}

DETECTION GUIDELINES:
- ANY question deserves a response action
- ANY problem needs an issue/support action  
- ANY mention of time (today, tomorrow, dates) creates scheduling actions
- ANY business/customer mention needs follow-up
- ANY "I need to", "should do", "have to" creates tasks (only if fromMe: true)
- ANY "I'll", "I will", "I'm going to" creates tasks (only if fromMe: true)
- ANY information sharing creates notes
- ANY learning/course content creates learning actions
- ANY technical commitment or promise creates tasks (only if fromMe: true)
- ANY development work or system deployment creates tasks (only if fromMe: true)
- ANY promise about "getting something running", "fixing", "deploying", "setting up" creates tasks (only if fromMe: true)
- ANY informal technical commitment like "ill get it up and running" creates tasks (only if fromMe: true)
- ANY mention of "real server", "production", "stable", "deployment" with future action creates tasks (only if fromMe: true)
- For fromMe: false messages, only detect if they're asking YOU to do something
- Look for words like "kau", "you", "please", "can you", "could you" in fromMe: false messages
- Be proactive - better to catch too much than miss important items
- Return only the most relevant action per message (highest confidence)
- Confidence > 0.7 is required for action creation
- Prioritize the most actionable and urgent items

EXAMPLES OF ACTIONABLE TECHNICAL COMMITMENTS (fromMe: true):
- "ill get it up and running in real server by then more stable" → task
- "I'll fix this bug tomorrow" → task  
- "I need to deploy the new version" → task
- "I'm going to set up the database" → task
- "I'll get the system working by next week" → task

If no actionable content found, return empty array [].
`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are an AI assistant that identifies actionable requests in WhatsApp messages. Respond only with valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      });

      const response = completion.choices[0].message.content.trim();
      console.log(`AI Processor: Raw response: ${response}`);
      
      try {
        const actions = JSON.parse(response);
        console.log(`AI Processor: Parsed ${actions.length} actions`);
        
        // Filter actions by confidence threshold and return only the best one
        const highConfidenceActions = actions.filter(action => action.confidence > 0.7);
        console.log(`AI Processor: ${highConfidenceActions.length} actions above confidence threshold`);
        
        if (highConfidenceActions.length === 0) {
          console.log(`AI Processor: No high confidence actions found`);
          return [];
        }
        
        // Return only the highest confidence action
        const bestAction = highConfidenceActions.reduce((best, current) => 
          current.confidence > best.confidence ? current : best
        );
        
        console.log(`AI Processor: Returning best action: ${bestAction.type} - ${bestAction.description}`);
        return [bestAction];
      } catch (parseError) {
        console.error('Error parsing AI response:', parseError);
        console.log('Raw AI response:', response);
        return [];
      }

    } catch (error) {
      console.error('Error processing message with AI:', error);
      console.log('Falling back to keyword detection');
      
      // Fallback: simple keyword detection
      const fallbackActions = this.fallbackProcessing(messageData);
      console.log(`Fallback processing returned ${fallbackActions.length} actions`);
      return fallbackActions;
    }
  }

  fallbackProcessing(messageData) {
    const message = messageData.body.toLowerCase();
    const actions = [];

    // SCHEDULING & TIME-BASED ACTIONS
    const timeKeywords = ['remind me', "don't forget", 'remember to', 'tomorrow', 'today', 'later', 'next week', 'esok', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'am', 'pm', 'o\'clock', 'morning', 'afternoon', 'evening', 'night'];
    if (timeKeywords.some(keyword => message.includes(keyword))) {
      actions.push({
        type: 'reminder',
        description: 'Time-based reminder or scheduling needed',
        details: {
          title: 'Reminder/Schedule',
          content: messageData.body,
          datetime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          priority: 'medium',
          category: 'scheduling',
          suggested_actions: ['Set reminder', 'Add to calendar', 'Create alert']
        },
        confidence: 0.8
      });
    }

    // EVENTS & MEETINGS
    const eventKeywords = ['meeting', 'appointment', 'schedule', 'course', 'training', 'session', 'conference', 'call', 'webinar', 'workshop', 'seminar', 'presentation', 'demo', 'interview', 'event'];
    if (eventKeywords.some(keyword => message.includes(keyword))) {
      actions.push({
        type: 'event',
        description: 'Schedule event or meeting',
        details: {
          title: 'Event Planning',
          content: messageData.body,
          priority: 'high',
          category: 'calendar',
          suggested_actions: ['Add to calendar', 'Send invites', 'Set reminder']
        },
        confidence: 0.8
      });
    }

    // TASKS & TODO ITEMS
    const taskKeywords = ['need to', 'have to', 'should', 'must', 'todo', 'task', 'complete', 'finish', 'do this', 'work on', 'handle', 'deal with', 'take care'];
    if (taskKeywords.some(keyword => message.includes(keyword))) {
      actions.push({
        type: 'task',
        description: 'Task or action item identified',
        details: {
          title: 'Task Assignment',
          content: messageData.body,
          priority: 'medium',
          category: 'productivity',
          suggested_actions: ['Add to task list', 'Set deadline', 'Track progress']
        },
        confidence: 0.75
      });
    }

    // INFORMATION & NOTES
    const noteKeywords = ['note this', 'save this', 'write down', 'remember that', 'important', 'information', 'details', 'reference', 'document', 'record'];
    if (noteKeywords.some(keyword => message.includes(keyword))) {
      actions.push({
        type: 'note',
        description: 'Information to save and organize',
        details: {
          title: 'Note Taking',
          content: messageData.body,
          priority: 'low',
          category: 'information',
          suggested_actions: ['Save to notes', 'Tag and organize', 'Create reference']
        },
        confidence: 0.8
      });
    }

    // ISSUES & PROBLEMS
    const issueKeywords = ['problem', 'issue', 'not working', 'broken', 'error', 'help', 'unstable', "couldn't", 'failed', 'bug', 'trouble', 'wrong', 'stuck', 'crash', 'freeze', 'slow', 'can\'t', 'won\'t', 'doesn\'t'];
    if (issueKeywords.some(keyword => message.includes(keyword))) {
      actions.push({
        type: 'issue',
        description: 'Technical or system issue reported',
        details: {
          title: 'Issue Resolution',
          content: messageData.body,
          priority: 'high',
          category: 'support',
          urgency_reason: 'System issues affect productivity',
          suggested_actions: ['Debug problem', 'Find solution', 'Contact support', 'Document fix']
        },
        confidence: 0.8
      });
    }

    // BUSINESS & CLIENT WORK
    const businessKeywords = ['customer', 'client', 'business', 'project', 'work', 'deadline', 'proposal', 'contract', 'sale', 'revenue', 'profit', 'marketing', 'campaign', 'launch'];
    if (businessKeywords.some(keyword => message.includes(keyword))) {
      actions.push({
        type: 'follow_up',
        description: 'Business or client matter needs attention',
        details: {
          title: 'Business Follow-up',
          content: messageData.body,
          priority: 'medium',
          category: 'business',
          suggested_actions: ['Schedule follow-up', 'Contact client', 'Update project status', 'Send proposal']
        },
        confidence: 0.75
      });
    }

    // QUESTIONS & INQUIRIES
    const questionKeywords = ['?', 'how', 'what', 'why', 'when', 'where', 'who', 'which', 'can you', 'could you', 'would you', 'should i', 'is it', 'are you', 'do you'];
    if (questionKeywords.some(keyword => message.includes(keyword))) {
      actions.push({
        type: 'communication',
        description: 'Question requires response',
        details: {
          title: 'Response Needed',
          content: messageData.body,
          priority: 'medium',
          category: 'communication',
          suggested_actions: ['Research answer', 'Provide response', 'Ask for clarification']
        },
        confidence: 0.75
      });
    }

    // LEARNING & EDUCATION
    const learningKeywords = ['learn', 'study', 'course', 'tutorial', 'training', 'skill', 'knowledge', 'research', 'understand', 'teach', 'education', 'book', 'read', 'practice'];
    if (learningKeywords.some(keyword => message.includes(keyword))) {
      actions.push({
        type: 'learning',
        description: 'Learning or educational content',
        details: {
          title: 'Learning Opportunity',
          content: messageData.body,
          priority: 'medium',
          category: 'education',
          suggested_actions: ['Find resources', 'Schedule learning time', 'Create study plan']
        },
        confidence: 0.7
      });
    }

    // FINANCIAL MATTERS
    const financeKeywords = ['money', 'pay', 'payment', 'invoice', 'bill', 'cost', 'price', 'budget', 'expense', 'income', 'profit', 'loss', 'investment', 'bank', 'account'];
    if (financeKeywords.some(keyword => message.includes(keyword))) {
      actions.push({
        type: 'finance',
        description: 'Financial matter needs attention',
        details: {
          title: 'Financial Task',
          content: messageData.body,
          priority: 'high',
          category: 'finance',
          suggested_actions: ['Review finances', 'Process payment', 'Update budget', 'Track expenses']
        },
        confidence: 0.8
      });
    }

    // HEALTH & WELLNESS
    const healthKeywords = ['doctor', 'appointment', 'medicine', 'health', 'sick', 'pain', 'exercise', 'gym', 'diet', 'nutrition', 'wellness', 'therapy', 'checkup'];
    if (healthKeywords.some(keyword => message.includes(keyword))) {
      actions.push({
        type: 'health',
        description: 'Health-related task or reminder',
        details: {
          title: 'Health & Wellness',
          content: messageData.body,
          priority: 'high',
          category: 'health',
          suggested_actions: ['Schedule appointment', 'Set health reminder', 'Track wellness']
        },
        confidence: 0.8
      });
    }

    // SHOPPING & PURCHASES
    const shoppingKeywords = ['buy', 'purchase', 'shop', 'order', 'delivery', 'shipping', 'product', 'item', 'store', 'market', 'sale', 'discount', 'cart'];
    if (shoppingKeywords.some(keyword => message.includes(keyword))) {
      actions.push({
        type: 'shopping',
        description: 'Shopping or purchase task',
        details: {
          title: 'Shopping List',
          content: messageData.body,
          priority: 'low',
          category: 'shopping',
          suggested_actions: ['Add to shopping list', 'Compare prices', 'Check availability']
        },
        confidence: 0.7
      });
    }

    // TRAVEL & LOGISTICS
    const travelKeywords = ['travel', 'trip', 'flight', 'hotel', 'booking', 'reservation', 'ticket', 'vacation', 'holiday', 'transport', 'uber', 'taxi', 'airport'];
    if (travelKeywords.some(keyword => message.includes(keyword))) {
      actions.push({
        type: 'travel',
        description: 'Travel planning or logistics',
        details: {
          title: 'Travel Planning',
          content: messageData.body,
          priority: 'medium',
          category: 'travel',
          suggested_actions: ['Book travel', 'Plan itinerary', 'Set reminders', 'Check requirements']
        },
        confidence: 0.8
      });
    }

    // CREATIVE & CONTENT
    const creativeKeywords = ['create', 'design', 'write', 'content', 'post', 'blog', 'video', 'photo', 'image', 'graphic', 'logo', 'brand', 'creative', 'idea', 'brainstorm'];
    if (creativeKeywords.some(keyword => message.includes(keyword))) {
      actions.push({
        type: 'creative',
        description: 'Creative or content creation task',
        details: {
          title: 'Creative Project',
          content: messageData.body,
          priority: 'medium',
          category: 'creative',
          suggested_actions: ['Start project', 'Gather resources', 'Create timeline', 'Review requirements']
        },
        confidence: 0.7
      });
    }

    // ADMINISTRATIVE TASKS
    const adminKeywords = ['form', 'application', 'register', 'signup', 'paperwork', 'document', 'certificate', 'license', 'renewal', 'submission', 'filing', 'process'];
    if (adminKeywords.some(keyword => message.includes(keyword))) {
      actions.push({
        type: 'administrative',
        description: 'Administrative task or paperwork',
        details: {
          title: 'Admin Task',
          content: messageData.body,
          priority: 'medium',
          category: 'administrative',
          suggested_actions: ['Complete forms', 'Gather documents', 'Set deadline', 'Track progress']
        },
        confidence: 0.75
      });
    }

    // If message is long enough, likely contains actionable content
    if (messageData.body.length > 50 && actions.length === 0) {
      actions.push({
        type: 'note',
        description: 'Detailed message - likely contains important information',
        details: {
          title: 'Information Capture',
          content: messageData.body,
          priority: 'low',
          category: 'general',
          context: 'Long message flagged for review',
          suggested_actions: ['Review content', 'Extract key points', 'Determine next steps']
        },
        confidence: 0.6
      });
    }

    // Return only the highest confidence action from fallback processing
    if (actions.length === 0) {
      return [];
    }
    
    const bestAction = actions.reduce((best, current) => 
      current.confidence > best.confidence ? current : best
    );
    
    return [bestAction];
  }
}

module.exports = AIProcessor;