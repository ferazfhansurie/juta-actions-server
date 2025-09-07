const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const OneSignal = require('onesignal-node');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

// Set Chrome path for macOS
process.env.CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SessionManager = require('./sessionManager');
const InternalItemsManager = require('./internalItemsManager');
const InternalItemsCRUD = require('./internalItemsCRUD');
const DashboardManager = require('./dashboardManager');
const DatabaseMigrator = require('./database/migrator');

class AIActionsServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: ["https://app.jutateknologi.com", "http://localhost:3001"],
        methods: ["GET", "POST"],
        credentials: true
      }
    });
    
    this.sessionManager = new SessionManager();
    this.userSockets = new Map(); // userId -> socket mapping
    this.isConnected = false;
    this.currentQRCode = null;
    this.pairingCode = null;

    // Database connection
    this.db = new Pool({
      connectionString: process.env.DATABASE_URL
    });

    // Initialize internal items manager
    this.internalItemsManager = new InternalItemsManager(this.db);
    this.internalItemsCRUD = new InternalItemsCRUD(this.db);
    this.dashboardManager = new DashboardManager(this.db, this.internalItemsCRUD);

    // Initialize OneSignal
    this.oneSignalClient = new OneSignal.Client(
      process.env.ONESIGNAL_APP_ID || '301d5b91-3055-4b33-8b34-902e885277f1',
      process.env.ONESIGNAL_API_KEY || 'os_v2_app_gaovxejqkvfthczusaxiqutx6fip7opmbg2u4wv65o55a5utwahrk5tveqxrvsq5vjmnklxwhzx255qng56pdha2iuw544yb3bdhzcq'
    );

    this.setupExpress();
    this.setupSocketIO();
    // Initialize session manager with socket.io and OneSignal client
    this.sessionManager.setSocketIO(this.io, this.userSockets);
    this.sessionManager.setOneSignalClient(this.oneSignalClient);
    
    // Initialize database and then existing sessions
    this.initializeDatabase().then(async () => {
      // Run migrations
      try {
        console.log('🔄 Running database migrations...');
        const migrator = new DatabaseMigrator(process.env.DATABASE_URL);
        await migrator.runMigrations();
        await migrator.close();
        console.log('✅ Database migrations completed');
      } catch (error) {
        console.error('❌ Migration failed:', error);
      }
      
      this.initializeExistingSessions();
    }).catch(error => {
      console.error('Error initializing database:', error);
    });
    
    // Cache for authorized phone numbers
    this.authorizedPhoneNumbers = new Set();
  }

  // Load authorized phone numbers from database
  async loadAuthorizedPhoneNumbers() {
    try {
      const result = await this.db.query(
        'SELECT phone_number FROM authorized_phone_numbers WHERE is_active = true'
      );
      
      this.authorizedPhoneNumbers.clear();
      result.rows.forEach(row => {
        this.authorizedPhoneNumbers.add(row.phone_number);
      });
      
      console.log(`✅ Loaded ${this.authorizedPhoneNumbers.size} authorized phone numbers from database`);
      return this.authorizedPhoneNumbers;
    } catch (error) {
      console.error('❌ Error loading authorized phone numbers:', error);
      // Fallback to empty set if database query fails
      this.authorizedPhoneNumbers.clear();
      throw new Error('Failed to load authorized phone numbers');
    }
  }

  // Authentication methods
  async login(phoneNumber) {
    // Refresh authorized phone numbers from database
    await this.loadAuthorizedPhoneNumbers();
    
    // Check if phone number is authorized
    if (!this.authorizedPhoneNumbers.has(phoneNumber)) {
      throw new Error('This phone number is not authorized to access the system');
    }

    // Create or get user
    const user = await this.createOrGetUser(phoneNumber);
    
    // Create WhatsApp session for this user
    try {
      await this.sessionManager.createUserSession(user.id, phoneNumber);
      console.log(`WhatsApp session created for user ${user.id} (${phoneNumber})`);
    } catch (error) {
      console.error(`Failed to create WhatsApp session for user ${user.id}:`, error);
      // Don't fail login if session creation fails, user can retry later
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, phoneNumber: user.phone_number },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    return {
      success: true,
      token,
      user: {
        id: user.id,
        phoneNumber: user.phone_number,
        name: user.name,
        isVerified: true
      }
    };
  }

  async createOrGetUser(phoneNumber) {
    try {
      // Check if user exists
      const existingUser = await this.db.query(
        'SELECT * FROM users WHERE phone_number = $1',
        [phoneNumber]
      );

      if (existingUser.rows.length > 0) {
        return existingUser.rows[0];
      }

      // Create new user
      const newUser = await this.db.query(
        'INSERT INTO users (phone_number, created_at, updated_at) VALUES ($1, NOW(), NOW()) RETURNING *',
        [phoneNumber]
      );

      return newUser.rows[0];
    } catch (error) {
      console.error('Error creating/getting user:', error);
      throw new Error('Failed to create user');
    }
  }

  async verifyToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      const user = await this.db.query(
        'SELECT * FROM users WHERE id = $1',
        [decoded.userId]
      );

      if (user.rows.length === 0) {
        throw new Error('User not found');
      }

      return {
        user: {
          id: user.rows[0].id,
          phoneNumber: user.rows[0].phone_number,
          name: user.rows[0].name,
          isVerified: true
        }
      };
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  async initializeExistingSessions() {
    try {
      console.log('🔄 Initializing existing user sessions...');
      
      // Get all users from database
      const users = await this.db.query('SELECT id, phone_number FROM users ORDER BY created_at ASC');
      
      if (users.rows.length === 0) {
        console.log('📭 No existing users found');
        return;
      }

      console.log(`👥 Found ${users.rows.length} existing users, initializing sessions...`);
      
      // Initialize sessions for all users with delay to avoid overwhelming the system
      for (let i = 0; i < users.rows.length; i++) {
        const user = users.rows[i];
        try {
          console.log(`🚀 Creating session for user ${user.id} (${user.phone_number}) [${i + 1}/${users.rows.length}]`);
          await this.sessionManager.createUserSession(user.id, user.phone_number);
          console.log(`✅ Session created for user ${user.id}`);
          
          // Add delay between session creations (except for the last one)
          if (i < users.rows.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
          }
        } catch (error) {
          console.error(`❌ Failed to create session for user ${user.id}:`, error.message);
        }
      }
      
      console.log('🎉 All existing user sessions initialized');
    } catch (error) {
      console.error('❌ Error initializing existing sessions:', error);
    }
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
    if (!actions || actions.length === 0) {
      return [];
    }

    // Create a more sophisticated deduplication based on content similarity
    const deduplicatedActions = [];
    const seenSignatures = new Set();
    
    for (const action of actions) {
      // Create a signature based on type, description, and original message content
      const originalMessage = typeof action.original_message === 'string' 
        ? JSON.parse(action.original_message) 
        : action.original_message;
      
      const signature = this.createActionSignature({
        type: action.type,
        description: action.description,
        originalMessage: originalMessage
      });
      
      // Check if we've seen this signature before
      if (!seenSignatures.has(signature)) {
        seenSignatures.add(signature);
        deduplicatedActions.push(action);
      } else {
        console.log(`Duplicate action filtered: ${action.type} - ${action.description}`);
      }
    }
    
    console.log(`Deduplicated ${actions.length} actions to ${deduplicatedActions.length} unique actions`);
    return deduplicatedActions;
  }

  createActionSignature(action) {
    // Create a normalized signature for duplicate detection
    const normalizedDescription = action.description.toLowerCase().trim();
    const messageBody = action.originalMessage?.body?.toLowerCase().trim() || '';
    
    // Combine type, normalized description, and message body for signature
    return `${action.type}:${normalizedDescription}:${messageBody}`;
  }

  // Send OneSignal notification for new action
  async sendActionNotification(action, userId) {
    try {
      // Use company-based targeting instead of individual player IDs
      // This matches how juta_app works - target all users in the company
      const companyId = '1';
      
      console.log(`📱 Sending OneSignal notification to company: ${companyId} for action ${action.action_id}`);
      
      const notification = {
        app_id: process.env.ONESIGNAL_APP_ID || '301d5b91-3055-4b33-8b34-902e885277f1',
        include_external_user_ids: [companyId], // Target by external user ID (company ID)
        headings: {
          en: '🎯 New Action Created!'
        },
        contents: {
          en: `${action.type}: ${action.description}`
        },
        data: {
          actionId: action.action_id,
          actionType: action.type,
          userId: userId,
          companyId: companyId
        },
        url: 'juta-actions://action/' + action.action_id
      };

      const response = await this.oneSignalClient.createNotification(notification);
      console.log(`✅ OneSignal notification sent for action ${action.action_id}:`, response);
    } catch (error) {
      // Enhanced error logging with more specific information
      if (error.statusCode === 400) {
        console.error(`❌ OneSignal API validation error for action ${action.action_id}:`, error.body);
        console.error(`   Company ID: ${companyId}`);
        console.error(`   User ID: ${userId}`);
      } else if (error.statusCode === 401) {
        console.error(`❌ OneSignal API authentication error for action ${action.action_id}: Check API key`);
      } else if (error.statusCode === 429) {
        console.error(`❌ OneSignal API rate limit exceeded for action ${action.action_id}`);
      } else {
        console.error(`❌ OneSignal API error for action ${action.action_id}:`, error.message || error);
      }
      
      // Send fallback notification when OneSignal fails
      await this.sendFallbackNotification(action, userId, `OneSignal error: ${error.message || error}`);
    }
  }

  // Send fallback notification when OneSignal fails
  async sendFallbackNotification(action, userId, reason) {
    try {
      console.log(`📱 Sending fallback notification for action ${action.action_id} to user ${userId}`);
      console.log(`📱 Reason: ${reason}`);
      
      // Store notification in database for later retrieval
      await this.db.query(
        'INSERT INTO notification_logs (user_id, action_id, notification_type, status, reason, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)',
        [userId, action.action_id, 'fallback', 'pending', reason]
      );
      
      // If user has an active socket connection, send real-time notification
      if (this.userSockets.has(userId)) {
        this.userSockets.get(userId).emit('newActionNotification', {
          actionId: action.action_id,
          type: action.type,
          description: action.description,
          fallback: true,
          reason: reason
        });
        console.log(`📱 Fallback notification sent via socket to user ${userId}`);
      } else {
        console.log(`📱 User ${userId} not connected via socket, notification logged for later retrieval`);
      }
      
    } catch (error) {
      console.error(`❌ Failed to send fallback notification for action ${action.action_id}:`, error);
    }
  }

  async initializeDatabase() {
    try {
      // Create users table if it doesn't exist
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          phone_number VARCHAR(20) UNIQUE NOT NULL,
          name VARCHAR(255),
          is_verified BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      // Add missing columns to existing users table
      try {
        await this.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20)`);
        await this.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255)`);
        await this.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false`);
        await this.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
        await this.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
        await this.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS onesignal_player_id VARCHAR(255)`);
        console.log('Added missing columns to users table');
      } catch (error) {
        console.log('Columns already exist or error adding them:', error.message);
      }

      // Create notification_logs table for fallback notifications
      try {
        await this.db.query(`
          CREATE TABLE IF NOT EXISTS notification_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            action_id VARCHAR(255) NOT NULL,
            notification_type VARCHAR(50) NOT NULL,
            status VARCHAR(50) NOT NULL,
            reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
          )
        `);
        console.log('Created notification_logs table');
      } catch (error) {
        console.log('notification_logs table already exists or error creating it:', error.message);
      }

      // Add your phone number to the database
      try {
        await this.db.query(`
          INSERT INTO users (phone_number, name, is_verified) 
          VALUES ('+601121677522', 'Firaz', true) 
          ON CONFLICT (phone_number) DO NOTHING
        `);
        console.log('Added your phone number to the database');
      } catch (error) {
        console.log('Phone number already exists or error adding it:', error.message);
      }

      await this.db.query(`
        CREATE TABLE IF NOT EXISTS ai_actions (
          id SERIAL PRIMARY KEY,
          action_id VARCHAR(255) UNIQUE NOT NULL,
          type VARCHAR(100) NOT NULL,
          description TEXT NOT NULL,
          status VARCHAR(50) DEFAULT 'pending',
          original_message JSONB NOT NULL,
          details JSONB,
          user_id INTEGER REFERENCES users(id) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Add the details column if it doesn't exist
      await this.db.query(`
        ALTER TABLE ai_actions 
        ADD COLUMN IF NOT EXISTS details JSONB
      `);
      
      // Add unique constraint to prevent duplicate actions from same message
      try {
        await this.db.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_message_action 
          ON ai_actions ((original_message->>'id'), type, description)
        `);
      } catch (error) {
        console.log('Unique index already exists or error creating it:', error.message);
      }
      
      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Error initializing database:', error);
    }
  }

  setupExpress() {
    this.app.use(cors({
      origin: ["https://app.jutateknologi.com", "http://localhost:3001"],
      methods: ["GET", "POST", "PUT", "DELETE"],
      credentials: true
    }));
    this.app.use(express.json());
    
    // Get authorized phone numbers (for frontend validation)
    this.app.get('/api/auth/authorized-numbers', async (req, res) => {
      try {
        await this.loadAuthorizedPhoneNumbers();
        const phoneNumbers = Array.from(this.authorizedPhoneNumbers);
        res.json({ success: true, phoneNumbers });
      } catch (error) {
        console.error('Error getting authorized phone numbers:', error);
        res.status(500).json({ success: false, error: 'Failed to get authorized phone numbers' });
      }
    });

    // Authentication routes
    this.app.post('/api/auth/login', async (req, res) => {
      try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber) {
          return res.status(400).json({ message: 'Phone number is required' });
        }

        const result = await this.login(phoneNumber);
        res.json(result);
      } catch (error) {
        console.error('Login error:', error);
        res.status(401).json({ message: error.message || 'Login failed' });
      }
    });

    this.app.get('/api/auth/verify', async (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const result = await this.verifyToken(token);
        res.json(result);
      } catch (error) {
        console.error('Token verification error:', error);
        res.status(401).json({ message: error.message || 'Invalid token' });
      }
    });
    
    this.app.get('/api/status', async (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;
        
        const userSession = this.sessionManager.getUserSession(userId);
        
        if (userSession) {
          res.json({
            connected: userSession.isConnected,
            qrCode: userSession.currentQRCode,
            pairingCode: userSession.pairingCode
          });
        } else {
          res.json({
            connected: false,
            qrCode: null,
            pairingCode: null
          });
        }
      } catch (error) {
        console.error('Status check error:', error);
        res.status(401).json({ message: 'Invalid token' });
      }
    });

    // Update OneSignal player ID for authenticated user
    this.app.post('/api/onesignal/player-id', async (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;
        
        const { playerId } = req.body;
        
        if (!playerId) {
          return res.status(400).json({ message: 'Player ID is required' });
        }

        // Update user's OneSignal player ID
        await this.db.query(
          'UPDATE users SET onesignal_player_id = $1, updated_at = NOW() WHERE id = $2',
          [playerId, userId]
        );

        console.log(`✅ OneSignal player ID updated for user ${userId}: ${playerId}`);
        
        res.json({ 
          success: true, 
          message: 'OneSignal player ID updated successfully',
          playerId: playerId
        });
      } catch (error) {
        console.error('Error updating OneSignal player ID:', error);
        res.status(500).json({ message: 'Failed to update OneSignal player ID' });
      }
    });
    
    // Get all pending actions for authenticated user
    this.app.get('/api/actions', async (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;
        
        const result = await this.db.query(
          'SELECT * FROM ai_actions WHERE status = $1 AND user_id = $2 ORDER BY created_at DESC',
          ['pending', userId]
        );
        
        console.log(`🔍 API /actions: Found ${result.rows.length} actions in database for user ${userId}`);
        
        // Deduplicate actions before sending to frontend
        const deduplicatedActions = this.deduplicateActions(result.rows);
        
        console.log(`📤 API /actions: Sending ${deduplicatedActions.length} deduplicated actions to frontend`);
        
        res.json({ success: true, actions: deduplicatedActions });
      } catch (error) {
        console.error('Error fetching actions:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch actions' });
      }
    });

    // OneSignal registration is no longer needed - using company-based targeting
    // All users in the company (1) will receive notifications

    // Approve an action
    this.app.post('/api/actions/:actionId/approve', async (req, res) => {
      const { actionId } = req.params;
      try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;
        
        // Get the action details before updating
        const actionResult = await this.db.query(
          'SELECT * FROM ai_actions WHERE action_id = $1 AND user_id = $2',
          [actionId, userId]
        );

        if (actionResult.rows.length === 0) {
          return res.status(404).json({ success: false, error: 'Action not found' });
        }

        const action = actionResult.rows[0];
        
        // Update action status to approved
        await this.db.query(
          'UPDATE ai_actions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE action_id = $2 AND user_id = $3',
          ['approved', actionId, userId]
        );

        // Create internal item based on action type
        try {
          let originalMessage;
          try {
            // Handle both JSON string and object cases
            originalMessage = typeof action.original_message === 'string' 
              ? JSON.parse(action.original_message) 
              : action.original_message;
          } catch (error) {
            console.error('Error parsing original_message:', error);
            originalMessage = action.original_message || {};
          }

          // Prepare action data for internal item creation
          const actionData = {
            actionId: action.action_id,
            type: action.type,
            description: action.description
          };

          // Prepare message data
          const messageData = {
            body: originalMessage.body || action.description || '',
            fromName: originalMessage.fromName || 'Unknown',
            fromNumber: originalMessage.fromNumber || null,
            location: originalMessage.location || null
          };

          // Create internal item
          const internalItem = await this.internalItemsManager.createInternalItemFromAction(
            actionData, 
            messageData, 
            userId
          );

          console.log(`✅ Created internal item for approved action ${actionId}:`, internalItem);

          // Notify specific user's frontend with internal item data
          if (this.userSockets.has(userId)) {
            this.userSockets.get(userId).emit('actionProcessed', { 
              actionId, 
              approved: true,
              internalItem: internalItem
            });
          }

          res.json({ 
            success: true, 
            internalItem: internalItem 
          });

        } catch (internalItemError) {
          console.error(`❌ Failed to create internal item for action ${actionId}:`, internalItemError);
          
          // Even if internal item creation fails, the action is still approved
          // Notify frontend of approval but without internal item
          if (this.userSockets.has(userId)) {
            this.userSockets.get(userId).emit('actionProcessed', { actionId, approved: true });
          }
          
          res.json({ 
            success: true, 
            warning: 'Action approved but failed to create internal item',
            error: internalItemError.message 
          });
        }
        
      } catch (error) {
        console.error('Error approving action:', error);
        res.status(500).json({ success: false, error: 'Failed to approve action' });
      }
    });

    // Reject an action
    this.app.post('/api/actions/:actionId/reject', async (req, res) => {
      const { actionId } = req.params;
      try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;
        
        await this.db.query(
          'UPDATE ai_actions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE action_id = $2 AND user_id = $3',
          ['rejected', actionId, userId]
        );
        
        // Notify specific user's frontend
        if (this.userSockets.has(userId)) {
          this.userSockets.get(userId).emit('actionProcessed', { actionId, approved: false });
        }
        
        res.json({ success: true });
      } catch (error) {
        console.error('Error rejecting action:', error);
        res.status(500).json({ success: false, error: 'Failed to reject action' });
      }
    });

    this.app.post('/api/pairing-code', async (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;
        
        const userSession = this.sessionManager.getUserSession(userId);
        
        if (userSession && userSession.client && !userSession.isConnected) {
          try {
            // Get phone number from request body or use session phone number
            const { phoneNumber } = req.body;
            const targetPhoneNumber = phoneNumber || userSession.phoneNumber;
            
            // Clean and format the phone number
            const cleanedPhoneNumber = targetPhoneNumber.replace(/\D/g, "");
            const formattedPhoneNumber = cleanedPhoneNumber.startsWith("+")
              ? cleanedPhoneNumber.slice(1)
              : cleanedPhoneNumber;
            
            // Try to request pairing code with error handling
            let code;
            try {
              code = await userSession.client.requestPairingCode(formattedPhoneNumber);
              console.log(`Pairing code generated successfully for user ${userId}: ${code}`);
            } catch (error) {
              console.error('Error requesting pairing code:', error);
              // If the standard method fails due to WhatsApp Web interface changes
              if (error.message && error.message.includes('window.onCodeReceivedEvent is not a function')) {
                console.log('WhatsApp Web interface has changed - pairing code method not available');
                // Return a helpful response instead of throwing an error
                return res.status(400).json({ 
                  success: false, 
                  error: 'Pairing code is temporarily unavailable due to WhatsApp Web updates. Please use the QR code method above to connect your account.',
                  useQRCode: true,
                  qrCode: userSession.currentQRCode
                });
              }
              // For other errors, still throw them
              throw error;
            }
            userSession.pairingCode = code;
            
            // Notify the user's socket
            if (this.userSockets.has(userId)) {
              this.userSockets.get(userId).emit('pairingCode', code);
            }
            
            res.json({ success: true, pairingCode: code });
          } catch (error) {
            console.error('Error requesting pairing code:', error);
            res.status(500).json({ success: false, error: 'Failed to request pairing code' });
          }
        } else {
          res.status(400).json({ success: false, error: 'Session not available or already connected' });
        }
      } catch (error) {
        console.error('Error processing pairing code request:', error);
        res.status(401).json({ message: 'Invalid token' });
      }
    });


    this.app.post('/api/chat', async (req, res) => {
      const { message } = req.body;
      
      try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;
        
        const result = await this.chatProcessor.processUserMessage(message);
        
        // Process any actions from the AI response
        for (const action of result.actions) {
          if (action.type === 'approve') {
            console.log(`Action ${action.actionId} approved by AI for user ${userId}`);
            this.chatProcessor.removeAction(action.actionId);
            if (this.userSockets.has(userId)) {
              this.userSockets.get(userId).emit('actionProcessed', { actionId: action.actionId, approved: true });
            }
          } else if (action.type === 'reject') {
            console.log(`Action ${action.actionId} rejected by AI for user ${userId}`);
            this.chatProcessor.removeAction(action.actionId);
            if (this.userSockets.has(userId)) {
              this.userSockets.get(userId).emit('actionProcessed', { actionId: action.actionId, approved: false });
            }
          } else if (action.type === 'create') {
            console.log(`New action created by AI for user ${userId}:`, action);
            if (this.userSockets.has(userId)) {
              this.userSockets.get(userId).emit('actionCreated', action);
            }
          }
        }
        
        res.json({ 
          success: true, 
          response: result.response,
          actions: result.actions 
        });
      } catch (error) {
        console.error('Error processing chat:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Failed to process message' 
        });
      }
    });

    // ================================
    // DASHBOARD API ENDPOINTS
    // ================================

    this.app.get('/api/dashboard', async (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;

        const dashboardData = await this.dashboardManager.getUserDashboardData(userId);
        res.json({ success: true, data: dashboardData });

      } catch (error) {
        console.error('Error getting dashboard data:', error);
        res.status(500).json({ success: false, error: 'Failed to get dashboard data' });
      }
    });

    this.app.get('/api/dashboard/quick-stats', async (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;

        const quickStats = await this.dashboardManager.getQuickStats(userId);
        res.json({ success: true, data: quickStats });

      } catch (error) {
        console.error('Error getting quick stats:', error);
        res.status(500).json({ success: false, error: 'Failed to get quick stats' });
      }
    });

    // ================================
    // INTERNAL ITEMS CRUD API ENDPOINTS
    // ================================

    // Get all items of a specific type
    this.app.get('/api/internal/:type', async (req, res) => {
      try {
        const { type } = req.params;
        const { status, limit, offset, orderBy, orderDirection } = req.query;
        
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;

        const items = await this.internalItemsCRUD.getAllItems(type, userId, {
          status,
          limit: limit ? parseInt(limit) : 100,
          offset: offset ? parseInt(offset) : 0,
          orderBy: orderBy || 'created_at',
          orderDirection: orderDirection || 'DESC'
        });

        res.json({ success: true, items, count: items.length });

      } catch (error) {
        console.error(`Error getting ${req.params.type} items:`, error);
        res.status(500).json({ success: false, error: `Failed to get ${req.params.type} items` });
      }
    });

    // Get specific item by ID
    this.app.get('/api/internal/:type/:itemId', async (req, res) => {
      try {
        const { type, itemId } = req.params;
        
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;

        const item = await this.internalItemsCRUD.getItem(type, itemId, userId);

        if (!item) {
          return res.status(404).json({ success: false, error: 'Item not found' });
        }

        res.json({ success: true, item });

      } catch (error) {
        console.error(`Error getting ${req.params.type} item:`, error);
        res.status(500).json({ success: false, error: `Failed to get ${req.params.type} item` });
      }
    });

    // Update specific item
    this.app.put('/api/internal/:type/:itemId', async (req, res) => {
      try {
        const { type, itemId } = req.params;
        const updates = req.body;
        
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;

        const updatedItem = await this.internalItemsCRUD.updateItem(type, itemId, userId, updates);

        if (!updatedItem) {
          return res.status(404).json({ success: false, error: 'Item not found' });
        }

        res.json({ success: true, item: updatedItem });

      } catch (error) {
        console.error(`Error updating ${req.params.type} item:`, error);
        res.status(500).json({ success: false, error: `Failed to update ${req.params.type} item` });
      }
    });

    // Delete specific item
    this.app.delete('/api/internal/:type/:itemId', async (req, res) => {
      try {
        const { type, itemId } = req.params;
        
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;

        const deletedItem = await this.internalItemsCRUD.deleteItem(type, itemId, userId);

        if (!deletedItem) {
          return res.status(404).json({ success: false, error: 'Item not found' });
        }

        res.json({ success: true, message: 'Item deleted successfully', item: deletedItem });

      } catch (error) {
        console.error(`Error deleting ${req.params.type} item:`, error);
        res.status(500).json({ success: false, error: `Failed to delete ${req.params.type} item` });
      }
    });

    // Update item status (complete, cancel, etc.)
    this.app.post('/api/internal/:type/:itemId/status', async (req, res) => {
      try {
        const { type, itemId } = req.params;
        const { status } = req.body;
        
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;

        const updatedItem = await this.internalItemsCRUD.updateItemStatus(type, itemId, userId, status);

        if (!updatedItem) {
          return res.status(404).json({ success: false, error: 'Item not found' });
        }

        res.json({ success: true, item: updatedItem });

      } catch (error) {
        console.error(`Error updating ${req.params.type} item status:`, error);
        res.status(500).json({ success: false, error: `Failed to update ${req.params.type} item status` });
      }
    });

    // ================================
    // SPECIFIC TYPE ENDPOINTS
    // ================================

    // Reminders
    this.app.get('/api/internal/reminders/upcoming', async (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;

        const reminders = await this.internalItemsCRUD.getUserReminders(userId, { upcoming: true });
        res.json({ success: true, reminders });

      } catch (error) {
        console.error('Error getting upcoming reminders:', error);
        res.status(500).json({ success: false, error: 'Failed to get upcoming reminders' });
      }
    });

    this.app.post('/api/internal/reminders/:itemId/snooze', async (req, res) => {
      try {
        const { itemId } = req.params;
        const { newDateTime } = req.body;
        
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;

        const snoozedReminder = await this.internalItemsCRUD.snoozeReminder(itemId, userId, newDateTime);

        if (!snoozedReminder) {
          return res.status(404).json({ success: false, error: 'Reminder not found' });
        }

        res.json({ success: true, reminder: snoozedReminder });

      } catch (error) {
        console.error('Error snoozing reminder:', error);
        res.status(500).json({ success: false, error: 'Failed to snooze reminder' });
      }
    });

    // Events
    this.app.get('/api/internal/events/today', async (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;

        const events = await this.dashboardManager.getTodayEvents(userId);
        res.json({ success: true, events });

      } catch (error) {
        console.error('Error getting today events:', error);
        res.status(500).json({ success: false, error: 'Failed to get today events' });
      }
    });

    // Tasks
    this.app.get('/api/internal/tasks/overdue', async (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;

        const tasks = await this.internalItemsCRUD.getOverdueTasks(userId);
        res.json({ success: true, tasks });

      } catch (error) {
        console.error('Error getting overdue tasks:', error);
        res.status(500).json({ success: false, error: 'Failed to get overdue tasks' });
      }
    });

    // Notes
    this.app.post('/api/internal/notes/:itemId/pin', async (req, res) => {
      try {
        const { itemId } = req.params;
        
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;

        const pinnedNote = await this.internalItemsCRUD.pinNote(itemId, userId);

        if (!pinnedNote) {
          return res.status(404).json({ success: false, error: 'Note not found' });
        }

        res.json({ success: true, note: pinnedNote });

      } catch (error) {
        console.error('Error pinning note:', error);
        res.status(500).json({ success: false, error: 'Failed to pin note' });
      }
    });

    this.app.post('/api/internal/notes/:itemId/unpin', async (req, res) => {
      try {
        const { itemId } = req.params;
        
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;

        const unpinnedNote = await this.internalItemsCRUD.unpinNote(itemId, userId);

        if (!unpinnedNote) {
          return res.status(404).json({ success: false, error: 'Note not found' });
        }

        res.json({ success: true, note: unpinnedNote });

      } catch (error) {
        console.error('Error unpinning note:', error);
        res.status(500).json({ success: false, error: 'Failed to unpin note' });
      }
    });

    // Issues
    this.app.post('/api/internal/issues/:itemId/resolve', async (req, res) => {
      try {
        const { itemId } = req.params;
        const { resolution } = req.body;
        
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;

        const resolvedIssue = await this.internalItemsCRUD.resolveIssue(itemId, userId, resolution);

        if (!resolvedIssue) {
          return res.status(404).json({ success: false, error: 'Issue not found' });
        }

        res.json({ success: true, issue: resolvedIssue });

      } catch (error) {
        console.error('Error resolving issue:', error);
        res.status(500).json({ success: false, error: 'Failed to resolve issue' });
      }
    });

    // ================================
    // SEARCH AND FILTER ENDPOINTS
    // ================================

    this.app.get('/api/internal/search', async (req, res) => {
      try {
        const { q: searchTerm, types, limit, status } = req.query;
        
        if (!searchTerm) {
          return res.status(400).json({ success: false, error: 'Search term is required' });
        }

        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;

        const typesArray = types ? types.split(',') : [];
        const results = await this.internalItemsCRUD.searchUserItems(userId, searchTerm, {
          types: typesArray,
          limit: limit ? parseInt(limit) : 50,
          status
        });

        res.json({ success: true, results, count: results.length });

      } catch (error) {
        console.error('Error searching items:', error);
        res.status(500).json({ success: false, error: 'Failed to search items' });
      }
    });

    this.app.get('/api/internal/filter/priority/:priority', async (req, res) => {
      try {
        const { priority } = req.params;
        const { types, limit } = req.query;
        
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;

        const typesArray = types ? types.split(',') : [];
        const results = await this.internalItemsCRUD.filterByPriority(userId, priority, {
          types: typesArray,
          limit: limit ? parseInt(limit) : 50
        });

        res.json({ success: true, results, count: results.length });

      } catch (error) {
        console.error('Error filtering by priority:', error);
        res.status(500).json({ success: false, error: 'Failed to filter by priority' });
      }
    });

    this.app.get('/api/internal/filter/date-range', async (req, res) => {
      try {
        const { start, end, types, limit } = req.query;
        
        if (!start || !end) {
          return res.status(400).json({ success: false, error: 'Start and end dates are required' });
        }

        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const userId = decoded.userId;

        const typesArray = types ? types.split(',') : [];
        const results = await this.internalItemsCRUD.filterByDateRange(userId, start, end, {
          types: typesArray,
          limit: limit ? parseInt(limit) : 50
        });

        res.json({ success: true, results, count: results.length });

      } catch (error) {
        console.error('Error filtering by date range:', error);
        res.status(500).json({ success: false, error: 'Failed to filter by date range' });
      }
    });

    // Process note with AI analysis (like WhatsApp messages)
    this.app.post('/api/process-note', async (req, res) => {
      try {
        const { userId, content, title } = req.body;
        
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'No token provided' });
        }
        
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const authenticatedUserId = decoded.userId;
        
        if (!content || !content.trim()) {
          return res.status(400).json({ success: false, error: 'Content is required' });
        }

        // Create a fake message structure like WhatsApp messages
        const fakeMessageData = {
          id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          from: 'brain_dump',
          fromName: 'Brain Dump',
          chatName: 'Notes',
          body: content.trim(),
          timestamp: Date.now(),
          type: 'text',
          isGroup: false,
          fromMe: true, // Mark as from user (like outgoing WhatsApp message)
          userId: authenticatedUserId
        };

        console.log(`Processing brain dump note from user ${authenticatedUserId}: "${content.substring(0, 100)}..."`);

        // Process through AI like a WhatsApp message
        const AIProcessor = require('./aiProcessor');
        const aiProcessor = new AIProcessor();
        
        // Get recent conversation history for context
        const recentActions = await this.db.query(
          'SELECT * FROM ai_actions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5',
          [authenticatedUserId]
        );
        
        const conversationHistory = recentActions.rows;
        const duplicateSignatures = new Set();
        
        // Process with AI
        const results = await aiProcessor.processMessageWithHistory(
          fakeMessageData, 
          conversationHistory, 
          duplicateSignatures
        );

        let createdActions = [];

        // If actions were detected, create them
        if (results && results.length > 0) {
          for (const actionResult of results) {
            try {
              // Generate actionId if not present
              const actionId = actionResult.actionId || `brain_dump_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
              
              // Store action in database
              const actionRecord = await this.db.query(
                `INSERT INTO ai_actions (action_id, type, description, status, original_message, details, user_id, created_at) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) 
                 RETURNING *`,
                [
                  actionId,
                  actionResult.type,
                  actionResult.description,
                  'pending',
                  JSON.stringify(fakeMessageData),
                  JSON.stringify(actionResult.details || {}),
                  authenticatedUserId
                ]
              );

              createdActions.push(actionRecord.rows[0]);
              console.log(`✅ AI Action created from brain dump: ${actionResult.type} - ${actionResult.description}`);
              
              // Send OneSignal notification
              await this.sendActionNotification(actionRecord.rows[0], authenticatedUserId);
              
              // Emit to frontend
              if (this.userSockets.has(authenticatedUserId)) {
                this.userSockets.get(authenticatedUserId).emit('newAction', actionRecord.rows[0]);
              }
            } catch (actionError) {
              console.error('Error creating action from brain dump:', actionError.message);
              // Continue processing other actions even if one fails
            }
          }
        }

        // Always create the note in internal_notes
        const noteRecord = await this.internalItemsCRUD.createItem('note', authenticatedUserId, {
          action_id: null, // No specific action ID for brain dump notes
          title: title || content.split('\n')[0]?.slice(0, 50) || 'Brain Dump Note',
          content: content,
          priority: 'medium',
          status: 'active',
          note_type: 'brain_dump',
          created_from: 'notes_app'
        });

        console.log(`✅ Brain dump note saved: "${noteRecord.title}"`);

        res.json({
          success: true,
          note: noteRecord,
          actions: createdActions,
          message: createdActions.length > 0 
            ? `AI detected ${createdActions.length} action(s) from your brain dump!` 
            : 'Note saved to your brain dump. No actions detected.'
        });

      } catch (error) {
        console.error('Error processing brain dump note:', error);
        res.status(500).json({ success: false, error: 'Failed to process note' });
      }
    });

    // Include Internal Items API routes
    const internalItemsAPI = require('./internalItemsAPI');
    this.app.use('/api/internal-items', internalItemsAPI);
  }

  setupSocketIO() {
    // Add authentication middleware for socket connections
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const user = await this.db.query(
          'SELECT * FROM users WHERE id = $1',
          [decoded.userId]
        );

        if (user.rows.length === 0) {
          return next(new Error('User not found'));
        }

        socket.userId = decoded.userId;
        socket.user = user.rows[0];
        next();
      } catch (error) {
        next(new Error('Invalid token'));
      }
    });

    this.io.on('connection', async (socket) => {
      const userId = socket.userId;
      console.log(`Frontend connected for user ${userId}`);
      
      // Store user socket mapping
      this.userSockets.set(userId, socket);
      
      // Get user's session
      const userSession = this.sessionManager.getUserSession(userId);
      
      if (userSession) {
        socket.emit('status', {
          connected: userSession.isConnected,
          qrCode: userSession.currentQRCode,
          pairingCode: userSession.pairingCode
        });
      } else {
        // Create session if it doesn't exist
        try {
          await this.sessionManager.createUserSession(userId, socket.user.phone_number);
          const newSession = this.sessionManager.getUserSession(userId);
          socket.emit('status', {
            connected: newSession.isConnected,
            qrCode: newSession.currentQRCode,
            pairingCode: newSession.pairingCode
          });
        } catch (error) {
          console.error(`Error creating session for user ${userId}:`, error);
          socket.emit('status', {
            connected: false,
            qrCode: null,
            pairingCode: null
          });
        }
      }

      // Send pending actions to newly connected frontend (user-specific)
      try {
        const result = await this.db.query(
          'SELECT * FROM ai_actions WHERE status = $1 AND user_id = $2 ORDER BY created_at DESC',
          ['pending', userId]
        );
        
        // Deduplicate actions before sending to frontend
        const deduplicatedActions = this.deduplicateActions(result.rows);
        
        console.log(`🔔 Socket connection: Sending ${deduplicatedActions.length} actions to user ${userId}`);
        
        for (const action of deduplicatedActions) {
          let originalMessage;
          try {
            // Handle both JSON string and object cases
            originalMessage = typeof action.original_message === 'string' 
              ? JSON.parse(action.original_message) 
              : action.original_message;
          } catch (error) {
            console.error('Error parsing original_message:', error);
            originalMessage = action.original_message || {};
          }
          
          console.log(`📤 Socket emitting action: ${action.action_id} - ${action.type}: ${action.description}`);
          socket.emit('newAction', {
            actionId: action.action_id,
            type: action.type,
            description: action.description,
            originalMessage: {
              fromName: originalMessage.fromName || 'Unknown',
              chatName: originalMessage.chatName || 'Unknown Chat',
              body: originalMessage.body || 'No message body',
              fromMe: originalMessage.fromMe || false,
              isGroup: originalMessage.isGroup || false
            },
            timestamp: action.created_at,
            status: action.status
          });
        }
      } catch (error) {
        console.error('Error fetching pending actions for new connection:', error);
      }

      socket.on('requestPairingCode', async () => {
        const userSession = this.sessionManager.getUserSession(userId);
        if (userSession && userSession.client && !userSession.isConnected) {
          try {
            const code = await userSession.client.requestPairingCode(socket.user.phone_number);
            userSession.pairingCode = code;
            socket.emit('pairingCode', code);
          } catch (error) {
            console.error('Error requesting pairing code:', error);
          }
        }
      });

      socket.on('disconnect', () => {
        console.log(`Frontend disconnected for user ${userId}`);
        this.userSockets.delete(userId);
      });
    });
  }


  async cleanup() {
    console.log('Cleaning up...');
    
    // Clean up all user sessions
    if (this.sessionManager) {
      const sessions = this.sessionManager.getAllSessions();
      for (const session of sessions) {
        try {
          await this.sessionManager.destroyUserSession(session.userId);
        } catch (error) {
          console.error(`Error destroying session for user ${session.userId}:`, error);
        }
      }
    }
    
    if (this.server && this.server.listening) {
      this.server.close();
    }
    
    // Only close database connection if we're actually shutting down
    if (this.db && !this.db.ended) {
      try {
        await this.db.end();
      } catch (error) {
        console.error('Error closing database connection:', error);
      }
    }
  }


  start(port = 3002) {
    this.server.on('error', async (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Please kill the existing process or use a different port.`);
        process.exit(1);
      } else {
        console.error('Server error:', error);
        // Don't cleanup on server errors, just exit
        process.exit(1);
      }
    });

    this.server.listen(port, () => {
      console.log(`AI Actions server running on port ${port}`);
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nReceived SIGINT, shutting down gracefully...');
      await this.cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\nReceived SIGTERM, shutting down gracefully...');
      await this.cleanup();
      process.exit(0);
    });

    process.on('uncaughtException', async (error) => {
      if (error.code === 'EADDRINUSE') {
        console.log('Port conflict detected, cleaning up...');
        await this.cleanup();
      } else {
        console.error('Uncaught Exception:', error);
        // For other uncaught exceptions, don't cleanup to avoid further issues
      }
      process.exit(1);
    });
  }
}

const server = new AIActionsServer();
server.start();