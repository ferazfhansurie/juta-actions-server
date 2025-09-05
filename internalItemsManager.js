const { Pool } = require('pg');

class InternalItemsManager {
  constructor(db) {
    this.db = db;
  }

  // ================================
  // CORE INTERNAL ITEM CREATION FUNCTIONS
  // ================================

  async createInternalReminder(actionId, title, content, userId, options = {}) {
    const {
      reminderDatetime = null,
      priority = 'medium',
      repeatType = 'none',
      createdFrom = 'whatsapp'
    } = options;

    try {
      const result = await this.db.query(
        `INSERT INTO internal_reminders 
         (action_id, title, content, reminder_datetime, priority, repeat_type, created_from, user_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
         RETURNING *`,
        [actionId, title, content, reminderDatetime, priority, repeatType, createdFrom, userId]
      );
      
      console.log(`✅ Created internal reminder for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating internal reminder:', error);
      throw error;
    }
  }

  async createInternalEvent(actionId, title, content, userId, options = {}) {
    const {
      eventDatetime = null,
      endDatetime = null,
      location = null,
      priority = 'medium',
      eventType = 'meeting',
      attendees = [],
      createdFrom = 'whatsapp'
    } = options;

    try {
      const result = await this.db.query(
        `INSERT INTO internal_events 
         (action_id, title, content, event_datetime, end_datetime, location, priority, event_type, attendees, created_from, user_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
         RETURNING *`,
        [actionId, title, content, eventDatetime, endDatetime, location, priority, eventType, JSON.stringify(attendees), createdFrom, userId]
      );
      
      console.log(`✅ Created internal event for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating internal event:', error);
      throw error;
    }
  }

  async createInternalTask(actionId, title, content, userId, options = {}) {
    const {
      dueDatetime = null,
      priority = 'medium',
      taskType = 'general',
      estimatedHours = null,
      tags = [],
      createdFrom = 'whatsapp'
    } = options;

    try {
      const result = await this.db.query(
        `INSERT INTO internal_tasks 
         (action_id, title, content, due_datetime, priority, task_type, estimated_hours, tags, created_from, user_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
         RETURNING *`,
        [actionId, title, content, dueDatetime, priority, taskType, estimatedHours, JSON.stringify(tags), createdFrom, userId]
      );
      
      console.log(`✅ Created internal task for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating internal task:', error);
      throw error;
    }
  }

  async createInternalNote(actionId, title, content, userId, options = {}) {
    const {
      noteDatetime = new Date().toISOString(),
      priority = 'medium',
      noteType = 'general',
      tags = [],
      isPinned = false,
      createdFrom = 'whatsapp'
    } = options;

    try {
      const result = await this.db.query(
        `INSERT INTO internal_notes 
         (action_id, title, content, note_datetime, priority, note_type, tags, is_pinned, created_from, user_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
         RETURNING *`,
        [actionId, title, content, noteDatetime, priority, noteType, JSON.stringify(tags), isPinned, createdFrom, userId]
      );
      
      console.log(`✅ Created internal note for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating internal note:', error);
      throw error;
    }
  }

  async createInternalContact(actionId, title, content, userId, options = {}) {
    const {
      contactDatetime = new Date().toISOString(),
      priority = 'medium',
      contactName = null,
      contactPhone = null,
      contactEmail = null,
      contactCompany = null,
      contactType = 'general',
      createdFrom = 'whatsapp'
    } = options;

    try {
      const result = await this.db.query(
        `INSERT INTO internal_contacts 
         (action_id, title, content, contact_datetime, priority, contact_name, contact_phone, contact_email, contact_company, contact_type, created_from, user_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
         RETURNING *`,
        [actionId, title, content, contactDatetime, priority, contactName, contactPhone, contactEmail, contactCompany, contactType, createdFrom, userId]
      );
      
      console.log(`✅ Created internal contact for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating internal contact:', error);
      throw error;
    }
  }

  async createInternalIssue(actionId, title, content, userId, options = {}) {
    const {
      issueDatetime = new Date().toISOString(),
      priority = 'medium',
      severity = 'minor',
      issueType = 'general',
      assignedTo = null,
      resolution = null,
      createdFrom = 'whatsapp'
    } = options;

    try {
      const result = await this.db.query(
        `INSERT INTO internal_issues 
         (action_id, title, content, issue_datetime, priority, severity, issue_type, assigned_to, resolution, created_from, user_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
         RETURNING *`,
        [actionId, title, content, issueDatetime, priority, severity, issueType, assignedTo, resolution, createdFrom, userId]
      );
      
      console.log(`✅ Created internal issue for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating internal issue:', error);
      throw error;
    }
  }

  async createInternalLearningItem(actionId, title, content, userId, options = {}) {
    const {
      learningDatetime = new Date().toISOString(),
      priority = 'medium',
      learningType = 'general',
      resourceUrl = null,
      estimatedDuration = null,
      completionPercentage = 0,
      tags = [],
      createdFrom = 'whatsapp'
    } = options;

    try {
      const result = await this.db.query(
        `INSERT INTO internal_learning_items 
         (action_id, title, content, learning_datetime, priority, learning_type, resource_url, estimated_duration, completion_percentage, tags, created_from, user_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
         RETURNING *`,
        [actionId, title, content, learningDatetime, priority, learningType, resourceUrl, estimatedDuration, completionPercentage, JSON.stringify(tags), createdFrom, userId]
      );
      
      console.log(`✅ Created internal learning item for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating internal learning item:', error);
      throw error;
    }
  }

  async createInternalFinanceItem(actionId, title, content, userId, options = {}) {
    const {
      financeDatetime = new Date().toISOString(),
      priority = 'medium',
      financeType = 'expense',
      amount = null,
      currency = 'USD',
      dueDate = null,
      category = null,
      account = null,
      createdFrom = 'whatsapp'
    } = options;

    try {
      const result = await this.db.query(
        `INSERT INTO internal_finance_items 
         (action_id, title, content, finance_datetime, priority, finance_type, amount, currency, due_date, category, account, created_from, user_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
         RETURNING *`,
        [actionId, title, content, financeDatetime, priority, financeType, amount, currency, dueDate, category, account, createdFrom, userId]
      );
      
      console.log(`✅ Created internal finance item for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating internal finance item:', error);
      throw error;
    }
  }

  async createInternalHealthItem(actionId, title, content, userId, options = {}) {
    const {
      healthDatetime = new Date().toISOString(),
      priority = 'medium',
      healthType = 'general',
      appointmentDatetime = null,
      doctorName = null,
      location = null,
      symptoms = [],
      medications = [],
      createdFrom = 'whatsapp'
    } = options;

    try {
      const result = await this.db.query(
        `INSERT INTO internal_health_items 
         (action_id, title, content, health_datetime, priority, health_type, appointment_datetime, doctor_name, location, symptoms, medications, created_from, user_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
         RETURNING *`,
        [actionId, title, content, healthDatetime, priority, healthType, appointmentDatetime, doctorName, location, JSON.stringify(symptoms), JSON.stringify(medications), createdFrom, userId]
      );
      
      console.log(`✅ Created internal health item for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating internal health item:', error);
      throw error;
    }
  }

  async createInternalShoppingItem(actionId, title, content, userId, options = {}) {
    const {
      shoppingDatetime = new Date().toISOString(),
      priority = 'medium',
      itemName = null,
      quantity = 1,
      estimatedPrice = null,
      store = null,
      category = null,
      shoppingListId = null,
      createdFrom = 'whatsapp'
    } = options;

    try {
      const result = await this.db.query(
        `INSERT INTO internal_shopping_items 
         (action_id, title, content, shopping_datetime, priority, item_name, quantity, estimated_price, store, category, shopping_list_id, created_from, user_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
         RETURNING *`,
        [actionId, title, content, shoppingDatetime, priority, itemName, quantity, estimatedPrice, store, category, shoppingListId, createdFrom, userId]
      );
      
      console.log(`✅ Created internal shopping item for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating internal shopping item:', error);
      throw error;
    }
  }

  async createInternalTravelItem(actionId, title, content, userId, options = {}) {
    const {
      travelDatetime = new Date().toISOString(),
      priority = 'medium',
      travelType = 'general',
      departureDate = null,
      returnDate = null,
      destination = null,
      departureLocation = null,
      bookingReference = null,
      travelerDetails = {},
      createdFrom = 'whatsapp'
    } = options;

    try {
      const result = await this.db.query(
        `INSERT INTO internal_travel_items 
         (action_id, title, content, travel_datetime, priority, travel_type, departure_date, return_date, destination, departure_location, booking_reference, traveler_details, created_from, user_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) 
         RETURNING *`,
        [actionId, title, content, travelDatetime, priority, travelType, departureDate, returnDate, destination, departureLocation, bookingReference, JSON.stringify(travelerDetails), createdFrom, userId]
      );
      
      console.log(`✅ Created internal travel item for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating internal travel item:', error);
      throw error;
    }
  }

  async createInternalCreativeItem(actionId, title, content, userId, options = {}) {
    const {
      creativeDatetime = new Date().toISOString(),
      priority = 'medium',
      creativeType = 'general',
      projectName = null,
      deadline = null,
      inspirationLinks = [],
      tags = [],
      progressNotes = null,
      createdFrom = 'whatsapp'
    } = options;

    try {
      const result = await this.db.query(
        `INSERT INTO internal_creative_items 
         (action_id, title, content, creative_datetime, priority, creative_type, project_name, deadline, inspiration_links, tags, progress_notes, created_from, user_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
         RETURNING *`,
        [actionId, title, content, creativeDatetime, priority, creativeType, projectName, deadline, JSON.stringify(inspirationLinks), JSON.stringify(tags), progressNotes, createdFrom, userId]
      );
      
      console.log(`✅ Created internal creative item for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating internal creative item:', error);
      throw error;
    }
  }

  async createInternalAdminItem(actionId, title, content, userId, options = {}) {
    const {
      adminDatetime = new Date().toISOString(),
      priority = 'medium',
      adminType = 'general',
      documentReference = null,
      deadline = null,
      department = null,
      approvalRequired = false,
      approvalStatus = null,
      createdFrom = 'whatsapp'
    } = options;

    try {
      const result = await this.db.query(
        `INSERT INTO internal_admin_items 
         (action_id, title, content, admin_datetime, priority, admin_type, document_reference, deadline, department, approval_required, approval_status, created_from, user_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
         RETURNING *`,
        [actionId, title, content, adminDatetime, priority, adminType, documentReference, deadline, department, approvalRequired, approvalStatus, createdFrom, userId]
      );
      
      console.log(`✅ Created internal admin item for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating internal admin item:', error);
      throw error;
    }
  }

  // ================================
  // HELPER FUNCTIONS
  // ================================

  extractDatetimeFromMessage(messageBody) {
    const now = new Date();
    let extractedDate = null;

    // Common time patterns
    const timePatterns = [
      /(\d{1,2}):(\d{2})\s*(am|pm|AM|PM)/g,
      /(\d{1,2})\s*(am|pm|AM|PM)/g,
      /(\d{1,2}):(\d{2})/g
    ];

    // Common date patterns
    const datePatterns = [
      /(tomorrow|esok)/gi,
      /(today|hari ini)/gi,
      /(next week|minggu depan)/gi,
      /(\d{1,2})\/(\d{1,2})\/(\d{4})/g,
      /(\d{1,2})-(\d{1,2})-(\d{4})/g,
      /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gi
    ];

    // Check for explicit date/time mentions
    for (const pattern of timePatterns) {
      const match = messageBody.match(pattern);
      if (match) {
        // Create a date for tomorrow if time is specified
        extractedDate = new Date(now);
        extractedDate.setDate(now.getDate() + 1);
        break;
      }
    }

    for (const pattern of datePatterns) {
      const match = messageBody.match(pattern);
      if (match) {
        const matchText = match[0].toLowerCase();
        if (matchText.includes('tomorrow') || matchText.includes('esok')) {
          extractedDate = new Date(now);
          extractedDate.setDate(now.getDate() + 1);
        } else if (matchText.includes('today') || matchText.includes('hari ini')) {
          extractedDate = new Date(now);
        } else if (matchText.includes('next week') || matchText.includes('minggu depan')) {
          extractedDate = new Date(now);
          extractedDate.setDate(now.getDate() + 7);
        }
        break;
      }
    }

    return extractedDate ? extractedDate.toISOString() : null;
  }

  extractPriorityFromMessage(messageBody) {
    const urgentKeywords = ['urgent', 'asap', 'emergency', 'critical', 'penting', 'segera'];
    const highKeywords = ['important', 'high priority', 'prioritas tinggi'];
    const lowKeywords = ['low priority', 'when you can', 'no rush', 'prioritas rendah'];

    const lowerBody = messageBody.toLowerCase();

    if (urgentKeywords.some(keyword => lowerBody.includes(keyword))) {
      return 'urgent';
    } else if (highKeywords.some(keyword => lowerBody.includes(keyword))) {
      return 'high';
    } else if (lowKeywords.some(keyword => lowerBody.includes(keyword))) {
      return 'low';
    }

    return 'medium';
  }

  generateTitle(actionType, messageBody, fromName) {
    const maxLength = 100;
    let title = '';

    switch (actionType) {
      case 'reminder':
        title = `Reminder from ${fromName}`;
        break;
      case 'event':
        title = `Meeting with ${fromName}`;
        break;
      case 'task':
        title = `Task from ${fromName}`;
        break;
      case 'note':
        title = `Note from ${fromName}`;
        break;
      case 'contact':
        title = `Contact: ${fromName}`;
        break;
      case 'issue':
        title = `Issue reported by ${fromName}`;
        break;
      case 'learning':
        title = `Learning item from ${fromName}`;
        break;
      case 'finance':
        title = `Finance item from ${fromName}`;
        break;
      case 'health':
        title = `Health item from ${fromName}`;
        break;
      case 'shopping':
        title = `Shopping item from ${fromName}`;
        break;
      case 'travel':
        title = `Travel item from ${fromName}`;
        break;
      case 'creative':
        title = `Creative item from ${fromName}`;
        break;
      case 'administrative':
        title = `Admin item from ${fromName}`;
        break;
      default:
        title = `${actionType} from ${fromName}`;
    }

    // Truncate if too long
    if (title.length > maxLength) {
      title = title.substring(0, maxLength - 3) + '...';
    }

    return title;
  }

  // ================================
  // MAIN CREATE INTERNAL ITEM FUNCTION
  // ================================

  async createInternalItemFromAction(action, messageData, userId) {
    const actionType = action.type;
    const messageBody = messageData.body || '';
    const fromName = messageData.fromName || 'Unknown';

    // Generate title and extract metadata
    const title = this.generateTitle(actionType, messageBody, fromName);
    const content = messageBody;
    const extractedDatetime = this.extractDatetimeFromMessage(messageBody);
    const priority = this.extractPriorityFromMessage(messageBody);

    // Common options
    const baseOptions = {
      priority,
      createdFrom: 'whatsapp'
    };

    try {
      let result = null;

      switch (actionType) {
        case 'reminder':
          result = await this.createInternalReminder(action.actionId, title, content, userId, {
            ...baseOptions,
            reminderDatetime: extractedDatetime
          });
          break;

        case 'event':
          result = await this.createInternalEvent(action.actionId, title, content, userId, {
            ...baseOptions,
            eventDatetime: extractedDatetime,
            location: messageData.location || null
          });
          break;

        case 'task':
          result = await this.createInternalTask(action.actionId, title, content, userId, {
            ...baseOptions,
            dueDatetime: extractedDatetime
          });
          break;

        case 'note':
        case 'follow_up':
          result = await this.createInternalNote(action.actionId, title, content, userId, baseOptions);
          break;

        case 'contact':
        case 'communication':
          result = await this.createInternalContact(action.actionId, title, content, userId, {
            ...baseOptions,
            contactName: fromName,
            contactPhone: messageData.fromNumber || null
          });
          break;

        case 'issue':
          result = await this.createInternalIssue(action.actionId, title, content, userId, baseOptions);
          break;

        case 'learning':
        case 'research':
          result = await this.createInternalLearningItem(action.actionId, title, content, userId, baseOptions);
          break;

        case 'finance':
          result = await this.createInternalFinanceItem(action.actionId, title, content, userId, baseOptions);
          break;

        case 'health':
          result = await this.createInternalHealthItem(action.actionId, title, content, userId, {
            ...baseOptions,
            appointmentDatetime: extractedDatetime
          });
          break;

        case 'shopping':
          result = await this.createInternalShoppingItem(action.actionId, title, content, userId, baseOptions);
          break;

        case 'travel':
          result = await this.createInternalTravelItem(action.actionId, title, content, userId, {
            ...baseOptions,
            departureDate: extractedDatetime
          });
          break;

        case 'creative':
          result = await this.createInternalCreativeItem(action.actionId, title, content, userId, {
            ...baseOptions,
            deadline: extractedDatetime
          });
          break;

        case 'administrative':
          result = await this.createInternalAdminItem(action.actionId, title, content, userId, {
            ...baseOptions,
            deadline: extractedDatetime
          });
          break;

        case 'question':
          // Questions become notes with special type
          result = await this.createInternalNote(action.actionId, title, content, userId, {
            ...baseOptions,
            noteType: 'question'
          });
          break;

        default:
          // Fallback to note for unknown types
          result = await this.createInternalNote(action.actionId, title, content, userId, {
            ...baseOptions,
            noteType: 'general'
          });
          break;
      }

      console.log(`✅ Created internal item of type ${actionType} for action ${action.actionId}`);
      return result;

    } catch (error) {
      console.error(`❌ Failed to create internal item for action ${action.actionId}:`, error);
      throw error;
    }
  }
}

module.exports = InternalItemsManager;