const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

class SessionManager {
  constructor() {
    this.sessions = new Map(); // userId -> session data
    
    // Database connection - initialize first
    this.db = new Pool({
      connectionString: process.env.DATABASE_URL
    });
    
    // Initialize processors with database connection
    this.aiProcessor = new (require('./aiProcessor'))();
    this.chatProcessor = new (require('./chatProcessor'))();
    this.messageGrouper = new (require('./messageGrouper'))(this.aiProcessor, this.db);

    // Setup periodic cleanup for message grouper
    setInterval(() => {
      this.messageGrouper.cleanup();
    }, 60 * 60 * 1000); // Cleanup every hour
  }

  async createUserSession(userId, phoneNumber) {
    try {
      // Check if session already exists
      if (this.sessions.has(userId)) {
        console.log(`Session already exists for user ${userId}`);
        return this.sessions.get(userId);
      }

      console.log(`Creating WhatsApp session for user ${userId} (${phoneNumber})`);
      
      // Emit initial status to user
      this.emitToUser(userId, 'status', { 
        status: 'initializing', 
        message: 'Creating WhatsApp session...',
        connected: false 
      });
      
      // Create unique session directory for this user
      const sessionDir = path.join(__dirname, 'wwebjs_auth', `session-${userId}`);
      
      // Ensure directory exists
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      // Clean up any existing lock files for this user
      const lockPath = path.join(sessionDir, 'SingletonLock');
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
        console.log(`Removed existing lock file for user ${userId}`);
      }

      // Create WhatsApp client for this user
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: `ai-actions-client-${userId}`,
          dataPath: sessionDir
        }),
        authTimeoutMs: 20000,
        takeoverOnConflict: true,
        restartOnAuthFail: true,
        puppeteer: {
          headless: true,
          executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
          ignoreHTTPSErrors: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-extensions",
            "--disable-gpu",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-dev-shm-usage",
            "--unhandled-rejections=strict",
            "--disable-gpu-driver-bug-workarounds",
            "--log-level=3",
            "--no-default-browser-check",
            "--disable-site-isolation-trials",
            "--no-experiments",
            "--ignore-gpu-blacklist",
            "--ignore-certificate-errors",
            "--ignore-certificate-errors-spki-list",
            "--disable-default-apps",
            "--enable-features=NetworkService",
            "--disable-webgl",
            "--disable-threaded-animation",
            "--disable-threaded-scrolling",
            "--disable-in-process-stack-traces",
            "--disable-histogram-customizer",
            "--disable-gl-extensions",
            "--disable-composited-antialiasing",
            "--disable-canvas-aa",
            "--disable-3d-apis",
            "--disable-accelerated-jpeg-decoding",
            "--disable-accelerated-mjpeg-decode",
            "--disable-app-list-dismiss-on-blur",
            "--disable-accelerated-video-decode",
          ],
          timeout: 120000,
        },
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        }
      });

      // Create session data object
      const sessionData = {
        userId,
        phoneNumber,
        client,
        isConnected: false,
        currentQRCode: null,
        pairingCode: null,
        createdAt: new Date(),
        lastActivity: new Date()
      };

      // Set up event handlers for this user's session
      this.setupSessionEventHandlers(sessionData);

      // Store session
      this.sessions.set(userId, sessionData);

      // Initialize the client
      try {
        this.emitToUser(userId, 'status', { 
          status: 'initializing', 
          message: 'Starting WhatsApp client...',
          connected: false 
        });
        
        await client.initialize();
        console.log(`WhatsApp client initialization started for user ${userId}`);
        
        this.emitToUser(userId, 'status', { 
          status: 'initializing', 
          message: 'WhatsApp client started, waiting for authentication...',
          connected: false 
        });
      } catch (error) {
        console.error(`Error initializing WhatsApp client for user ${userId}:`, error);
        this.emitToUser(userId, 'status', { 
          status: 'error', 
          message: 'Failed to start WhatsApp client',
          connected: false 
        });
        throw error;
      }

      return sessionData;
    } catch (error) {
      console.error(`Error creating session for user ${userId}:`, error);
      throw error;
    }
  }

  setupSessionEventHandlers(sessionData) {
    const { client, userId } = sessionData;

    client.on('qr', (qr) => {
      console.log(`QR Code received for user ${userId}`);
      sessionData.currentQRCode = qr;
      
      // Emit status update
      this.emitToUser(userId, 'status', { 
        status: 'qr', 
        message: 'QR Code ready - scan to connect',
        connected: false 
      });
      
      // Emit QR code to specific user's socket
      this.emitToUser(userId, 'qrCode', qr);
      
      // Also display in terminal for development
      qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
      console.log(`WhatsApp Client is ready for user ${userId}!`);
      sessionData.isConnected = true;
      sessionData.currentQRCode = null;
      sessionData.pairingCode = null;
      sessionData.lastActivity = new Date();
      
      // Emit status update
      this.emitToUser(userId, 'status', { 
        status: 'ready', 
        message: 'WhatsApp connected successfully!',
        connected: true 
      });
      
      this.emitToUser(userId, 'connected');
      console.log(`AI Actions is now monitoring messages for user ${userId}...`);
    });

    client.on('authenticated', () => {
      console.log(`WhatsApp Client authenticated for user ${userId}`);
    });

    client.on('auth_failure', (msg) => {
      console.error(`Authentication failed for user ${userId}:`, msg);
      this.emitToUser(userId, 'authError', msg);
    });

    client.on('disconnected', (reason) => {
      console.log(`WhatsApp Client disconnected for user ${userId}:`, reason);
      sessionData.isConnected = false;
      this.emitToUser(userId, 'disconnected', reason);
    });

    client.on('message', async (message) => {
      try {
        // Early validation to skip problematic messages
        if (!message || !message.id) {
          console.log(`Message without proper structure - skipping processing`);
          return;
        }
        
        // Safely get contact and chat information with error handling
        let contact = null;
        let chat = null;
        
        try {
          // First get chat to determine if it's a group
          chat = await message.getChat();
          
          // For group messages, skip contact resolution if it's problematic
          if (chat && chat.isGroup) {
            // In groups, use message author or from for contact info without calling getContact()
            const contactId = message.author || message.from || 'unknown';
            contact = {
              number: contactId,
              name: `Group Member (${contactId})`,
              pushname: `Group Member (${contactId})`
            };
          } else if (message.author || message.from) {
            contact = await message.getContact();
          } else {
            throw new Error('No contact ID available');
          }
        } catch (error) {
          console.warn(`Could not get contact/chat for incoming message: ${error.message}`);
          // Create fallback objects
          contact = {
            number: message.from || message.author || 'unknown',
            name: 'Unknown Contact',
            pushname: 'Unknown'
          };
          if (!chat) {
            chat = {
              name: 'Unknown Chat',
              isGroup: false
            };
          }
        }
        
        const messageData = {
          id: message.id?._serialized || `fallback_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          from: contact?.number || message.from || message.author || 'unknown',
          fromName: contact?.name || contact?.pushname || 'Unknown Contact',
          chatName: chat?.name || 'Unknown Chat',
          body: message.body || '',
          timestamp: message.timestamp || Date.now(),
          type: message.type || 'text',
          isGroup: chat?.isGroup || false,
          fromMe: message.fromMe || false,
          userId: userId // Add user context
        };

        console.log(`${message.fromMe ? 'Outgoing' : 'Incoming'} message for user ${userId}:`, messageData);
        
        // Only process incoming messages in the message event (outgoing handled in message_create)
        if (message.fromMe) {
          console.log(`Outgoing message - handled by message_create event, skipping...`);
          return;
        }
        
        // Filter out problematic messages early
        if (!message.id || !message.id._serialized) {
          console.log(`Message without proper ID structure - skipping processing`);
          return;
        }
        
        // Filter out status messages before processing
        if (messageData.from && messageData.from.includes("status")) {
          console.log(`Status message filtered out - skipping processing`);
          return;
        }
        
        // Filter out system messages or messages without body
        if (!messageData.body || messageData.body.trim() === '') {
          console.log(`Empty message body - skipping processing`);
          return;
        }
        
        // Note: Removed pre-filtering of group messages - let AI decide if message is relevant
        
        // Check if we already processed this message for this user
        const existingActions = await this.db.query(
          'SELECT * FROM ai_actions WHERE original_message->>\'id\' = $1 AND user_id = $2',
          [messageData.id, userId]
        );
        
        if (existingActions.rows.length > 0) {
          console.log(`Message ${messageData.id} already processed for user ${userId}, skipping...`);
          return;
        }
        
        // Process message with enhanced grouper that handles delay and deduplication
        await this.messageGrouper.processMessage(messageData, userId, this.emitToUser.bind(this));
        
        // Update last activity
        sessionData.lastActivity = new Date();
        
      } catch (error) {
        console.error(`Error processing incoming message for user ${userId}:`, error.message);
        // Don't crash the session - just log the error and continue
        if (error.message && error.message.includes('Data passed to getter must include an id property')) {
          console.warn(`Skipping message due to WhatsApp Web.js contact/chat data issue - this is common in groups`);
        }
      }
    });

    // Handle outgoing messages specifically (message_create event)
    client.on('message_create', async (message) => {
      try {
        // Only process outgoing messages
        if (!message.fromMe) {
          return;
        }

        // Early validation to skip problematic messages
        if (!message || !message.id) {
          console.log(`Outgoing message without proper structure - skipping processing`);
          return;
        }

        // Safely get contact and chat information with error handling
        let contact = null;
        let chat = null;
        
        try {
          // First get chat to determine if it's a group
          chat = await message.getChat();
          
          // For group messages, skip contact resolution if it's problematic
          if (chat && chat.isGroup) {
            // In groups, use message author or from for contact info without calling getContact()
            const contactId = message.author || message.from || 'unknown';
            contact = {
              number: contactId,
              name: `Group Member (${contactId})`,
              pushname: `Group Member (${contactId})`
            };
          } else if (message.author || message.from) {
            contact = await message.getContact();
          } else {
            throw new Error('No contact ID available');
          }
        } catch (error) {
          console.warn(`Could not get contact/chat for outgoing message: ${error.message}`);
          // Create fallback objects
          contact = {
            number: message.from || message.author || 'unknown',
            name: 'Unknown Contact',
            pushname: 'Unknown'
          };
          if (!chat) {
            chat = {
              name: 'Unknown Chat',
              isGroup: false
            };
          }
        }
        
        const messageData = {
          id: message.id?._serialized || `fallback_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          from: contact?.number || message.from || message.author || 'unknown',
          fromName: contact?.name || contact?.pushname || 'Unknown Contact',
          chatName: chat?.name || 'Unknown Chat',
          body: message.body || '',
          timestamp: message.timestamp || Date.now(),
          type: message.type || 'text',
          isGroup: chat?.isGroup || false,
          fromMe: message.fromMe || false,
          userId: userId
        };

        console.log(`Outgoing message created for user ${userId}:`, messageData);
        
        // Filter out problematic messages early
        if (!message.id || !message.id._serialized) {
          console.log(`Outgoing message without proper ID structure - skipping processing`);
          return;
        }
        
        // Filter out status messages before processing
        if (messageData.from && messageData.from.includes("status")) {
          console.log(`Status message filtered out - skipping processing`);
          return;
        }
        
        // Filter out system messages or messages without body
        if (!messageData.body || messageData.body.trim() === '') {
          console.log(`Empty outgoing message body - skipping processing`);
          return;
        }
        
        // Check if we already processed this message for this user
        const existingActions = await this.db.query(
          'SELECT * FROM ai_actions WHERE original_message->>\'id\' = $1 AND user_id = $2',
          [messageData.id, userId]
        );
        
        if (existingActions.rows.length > 0) {
          console.log(`Message ${messageData.id} already processed for user ${userId}, skipping...`);
          return;
        }
        
        // Process outgoing message with enhanced grouper
        await this.messageGrouper.processMessage(messageData, userId, this.emitToUser.bind(this));
        
        // Update last activity
        sessionData.lastActivity = new Date();
        
      } catch (error) {
        console.error(`Error processing outgoing message for user ${userId}:`, error.message);
        // Don't crash the session - just log the error and continue
        if (error.message && error.message.includes('Data passed to getter must include an id property')) {
          console.warn(`Skipping outgoing message due to WhatsApp Web.js contact/chat data issue - this is common in groups`);
        }
      }
    });

  }

  generateActionContent(action, messageData) {
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
    // Simple datetime extraction - you can make this more sophisticated
    const timeRegex = /(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/g;
    const dateRegex = /(esok|tomorrow|today|hari ini|next week|minggu depan)/gi;
    
    const timeMatch = messageBody.match(timeRegex);
    const dateMatch = messageBody.match(dateRegex);
    
    if (timeMatch || dateMatch) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString();
    }
    
    return null;
  }

  deduplicateActions(actions) {
    // Group actions by type and select the highest confidence one
    const actionMap = new Map();
    
    for (const action of actions) {
      const existingAction = actionMap.get(action.type);
      
      if (!existingAction || action.confidence > existingAction.confidence) {
        actionMap.set(action.type, action);
      }
    }
    
    return Array.from(actionMap.values());
  }

  emitToUser(userId, event, data) {
    // This will be set by the main server to emit to specific user's socket
    if (this.io && this.userSockets && this.userSockets.has(userId)) {
      const socket = this.userSockets.get(userId);
      socket.emit(event, data);
    }
  }

  getUserSession(userId) {
    return this.sessions.get(userId);
  }

  getAllSessions() {
    return Array.from(this.sessions.values());
  }

  async destroyUserSession(userId) {
    try {
      const session = this.sessions.get(userId);
      if (session && session.client) {
        console.log(`Destroying WhatsApp session for user ${userId}`);
        
        const browser = session.client.pupPage?.browser();
        if (browser) {
          await browser.close().catch((err) => console.log(`Browser close error for user ${userId}:`, err));
        }
        await session.client.destroy().catch((err) => console.log(`Client destroy error for user ${userId}:`, err));
        
        this.sessions.delete(userId);
        console.log(`Session destroyed for user ${userId}`);
      }
    } catch (error) {
      console.error(`Error destroying session for user ${userId}:`, error);
    }
  }

  async cleanupInactiveSessions(maxInactiveMinutes = 60) {
    const now = new Date();
    const inactiveSessions = [];

    for (const [userId, session] of this.sessions) {
      const inactiveMinutes = (now - session.lastActivity) / (1000 * 60);
      if (inactiveMinutes > maxInactiveMinutes) {
        inactiveSessions.push(userId);
      }
    }

    for (const userId of inactiveSessions) {
      console.log(`Cleaning up inactive session for user ${userId}`);
      await this.destroyUserSession(userId);
    }

    return inactiveSessions.length;
  }

  setSocketIO(io, userSockets) {
    this.io = io;
    this.userSockets = userSockets;
  }
}

module.exports = SessionManager;
