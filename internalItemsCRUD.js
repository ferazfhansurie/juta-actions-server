const { Pool } = require('pg');

class InternalItemsCRUD {
  constructor(db) {
    this.db = db;
    
    // Define table mappings
    this.tableMap = {
      'reminder': 'internal_reminders',
      'event': 'internal_events',
      'task': 'internal_tasks',
      'note': 'internal_notes',
      'contact': 'internal_contacts',
      'issue': 'internal_issues',
      'learning': 'internal_learning_items',
      'research': 'internal_learning_items', // Map research to learning
      'finance': 'internal_finance_items',
      'health': 'internal_health_items',
      'shopping': 'internal_shopping_items',
      'travel': 'internal_travel_items',
      'creative': 'internal_creative_items',
      'administrative': 'internal_admin_items',
      'communication': 'internal_contacts', // Map communication to contacts
      'follow_up': 'internal_notes', // Map follow_up to notes
      'question': 'internal_notes' // Map question to notes
    };
  }

  // ================================
  // GENERIC CRUD OPERATIONS
  // ================================

  getTableName(type) {
    return this.tableMap[type] || 'internal_notes'; // Default to notes
  }

  async getItem(type, itemId, userId) {
    try {
      const tableName = this.getTableName(type);
      const result = await this.db.query(
        `SELECT * FROM ${tableName} WHERE id = $1 AND user_id = $2`,
        [itemId, userId]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error(`Error getting ${type} item:`, error);
      throw error;
    }
  }

  async getAllItems(type, userId, options = {}) {
    try {
      const tableName = this.getTableName(type);
      const { status, limit = 100, offset = 0, orderBy = 'created_at', orderDirection = 'DESC' } = options;

      let query = `SELECT * FROM ${tableName} WHERE user_id = $1`;
      const params = [userId];

      if (status) {
        query += ` AND status = $${params.length + 1}`;
        params.push(status);
      }

      query += ` ORDER BY ${orderBy} ${orderDirection} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result = await this.db.query(query, params);
      return result.rows;
    } catch (error) {
      console.error(`Error getting ${type} items:`, error);
      throw error;
    }
  }

  async updateItem(type, itemId, userId, updates) {
    try {
      const tableName = this.getTableName(type);
      
      // Build dynamic update query
      const updateFields = [];
      const params = [];
      let paramCount = 1;

      // Add updated_at timestamp
      updates.updated_at = 'CURRENT_TIMESTAMP';

      for (const [field, value] of Object.entries(updates)) {
        if (field === 'updated_at') {
          updateFields.push(`${field} = CURRENT_TIMESTAMP`);
        } else {
          updateFields.push(`${field} = $${paramCount}`);
          params.push(value);
          paramCount++;
        }
      }

      if (updateFields.length === 0) {
        throw new Error('No fields to update');
      }

      // Add itemId and userId to params
      params.push(itemId, userId);
      
      const query = `
        UPDATE ${tableName} 
        SET ${updateFields.join(', ')} 
        WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
        RETURNING *
      `;

      const result = await this.db.query(query, params);
      return result.rows[0] || null;
    } catch (error) {
      console.error(`Error updating ${type} item:`, error);
      throw error;
    }
  }

  async createItem(type, userId, itemData) {
    try {
      const tableName = this.getTableName(type);
      
      // Prepare data without timestamp fields first
      const data = {
        user_id: userId,
        ...itemData
      };

      // Build dynamic insert query
      const fields = Object.keys(data);
      const values = Object.values(data);
      const placeholders = fields.map((_, index) => `$${index + 1}`);

      // Add timestamp fields to the query
      fields.push('created_at', 'updated_at');
      placeholders.push('CURRENT_TIMESTAMP', 'CURRENT_TIMESTAMP');

      const query = `
        INSERT INTO ${tableName} (${fields.join(', ')})
        VALUES (${placeholders.join(', ')})
        RETURNING *
      `;

      const result = await this.db.query(query, values);
      return result.rows[0] || null;
    } catch (error) {
      console.error(`Error creating ${type} item:`, error);
      throw error;
    }
  }

  async deleteItem(type, itemId, userId) {
    try {
      const tableName = this.getTableName(type);
      const result = await this.db.query(
        `DELETE FROM ${tableName} WHERE id = $1 AND user_id = $2 RETURNING *`,
        [itemId, userId]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error(`Error deleting ${type} item:`, error);
      throw error;
    }
  }

  // ================================
  // STATUS MANAGEMENT
  // ================================

  async updateItemStatus(type, itemId, userId, status) {
    try {
      return await this.updateItem(type, itemId, userId, { status });
    } catch (error) {
      console.error(`Error updating ${type} item status:`, error);
      throw error;
    }
  }

  async completeItem(type, itemId, userId) {
    try {
      return await this.updateItemStatus(type, itemId, userId, 'completed');
    } catch (error) {
      console.error(`Error completing ${type} item:`, error);
      throw error;
    }
  }

  async cancelItem(type, itemId, userId) {
    try {
      return await this.updateItemStatus(type, itemId, userId, 'cancelled');
    } catch (error) {
      console.error(`Error cancelling ${type} item:`, error);
      throw error;
    }
  }

  // ================================
  // SPECIFIC ITEM TYPE FUNCTIONS
  // ================================

  // Reminder-specific functions
  async getUserReminders(userId, options = {}) {
    try {
      const { status = 'active', upcoming = false } = options;
      let query = 'SELECT * FROM internal_reminders WHERE user_id = $1';
      const params = [userId];

      if (status) {
        query += ` AND status = $${params.length + 1}`;
        params.push(status);
      }

      if (upcoming) {
        query += ` AND reminder_datetime > CURRENT_TIMESTAMP`;
      }

      query += ' ORDER BY reminder_datetime ASC';

      const result = await this.db.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Error getting user reminders:', error);
      throw error;
    }
  }

  async snoozeReminder(reminderId, userId, newDateTime) {
    try {
      const result = await this.db.query(
        `UPDATE internal_reminders 
         SET reminder_datetime = $1, status = 'snoozed', updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2 AND user_id = $3 
         RETURNING *`,
        [newDateTime, reminderId, userId]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error snoozing reminder:', error);
      throw error;
    }
  }

  // Event-specific functions
  async getUserEvents(userId, options = {}) {
    try {
      const { status = 'active', upcoming = false, dateRange } = options;
      let query = 'SELECT * FROM internal_events WHERE user_id = $1';
      const params = [userId];

      if (status) {
        query += ` AND status = $${params.length + 1}`;
        params.push(status);
      }

      if (upcoming) {
        query += ` AND event_datetime > CURRENT_TIMESTAMP`;
      }

      if (dateRange && dateRange.start && dateRange.end) {
        query += ` AND event_datetime BETWEEN $${params.length + 1} AND $${params.length + 2}`;
        params.push(dateRange.start, dateRange.end);
      }

      query += ' ORDER BY event_datetime ASC';

      const result = await this.db.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Error getting user events:', error);
      throw error;
    }
  }

  // Task-specific functions
  async getUserTasks(userId, options = {}) {
    try {
      const { status = 'active', overdue = false, priority } = options;
      let query = 'SELECT * FROM internal_tasks WHERE user_id = $1';
      const params = [userId];

      if (status) {
        query += ` AND status = $${params.length + 1}`;
        params.push(status);
      }

      if (overdue) {
        query += ` AND due_datetime < CURRENT_TIMESTAMP AND status != 'completed'`;
      }

      if (priority) {
        query += ` AND priority = $${params.length + 1}`;
        params.push(priority);
      }

      query += ' ORDER BY due_datetime ASC NULLS LAST, priority DESC';

      const result = await this.db.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Error getting user tasks:', error);
      throw error;
    }
  }

  async getOverdueTasks(userId) {
    try {
      return await this.getUserTasks(userId, { overdue: true });
    } catch (error) {
      console.error('Error getting overdue tasks:', error);
      throw error;
    }
  }

  // Notes-specific functions
  async getUserNotes(userId, options = {}) {
    try {
      const { status = 'active', isPinned, noteType, tags } = options;
      let query = 'SELECT * FROM internal_notes WHERE user_id = $1';
      const params = [userId];

      if (status) {
        query += ` AND status = $${params.length + 1}`;
        params.push(status);
      }

      if (typeof isPinned === 'boolean') {
        query += ` AND is_pinned = $${params.length + 1}`;
        params.push(isPinned);
      }

      if (noteType) {
        query += ` AND note_type = $${params.length + 1}`;
        params.push(noteType);
      }

      if (tags && tags.length > 0) {
        query += ` AND tags ?| $${params.length + 1}`;
        params.push(tags);
      }

      query += ' ORDER BY is_pinned DESC, created_at DESC';

      const result = await this.db.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Error getting user notes:', error);
      throw error;
    }
  }

  async pinNote(noteId, userId) {
    try {
      return await this.updateItem('note', noteId, userId, { is_pinned: true });
    } catch (error) {
      console.error('Error pinning note:', error);
      throw error;
    }
  }

  async unpinNote(noteId, userId) {
    try {
      return await this.updateItem('note', noteId, userId, { is_pinned: false });
    } catch (error) {
      console.error('Error unpinning note:', error);
      throw error;
    }
  }

  // Issue-specific functions
  async getUserIssues(userId, options = {}) {
    try {
      const { status = 'active', severity, priority } = options;
      let query = 'SELECT * FROM internal_issues WHERE user_id = $1';
      const params = [userId];

      if (status) {
        query += ` AND status = $${params.length + 1}`;
        params.push(status);
      }

      if (severity) {
        query += ` AND severity = $${params.length + 1}`;
        params.push(severity);
      }

      if (priority) {
        query += ` AND priority = $${params.length + 1}`;
        params.push(priority);
      }

      query += ' ORDER BY severity DESC, priority DESC, created_at DESC';

      const result = await this.db.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Error getting user issues:', error);
      throw error;
    }
  }

  async resolveIssue(issueId, userId, resolution) {
    try {
      return await this.updateItem('issue', issueId, userId, { 
        status: 'resolved',
        resolution: resolution
      });
    } catch (error) {
      console.error('Error resolving issue:', error);
      throw error;
    }
  }

  // ================================
  // SEARCH AND FILTER FUNCTIONS
  // ================================

  async searchUserItems(userId, searchTerm, options = {}) {
    try {
      const { types = [], limit = 50, status } = options;
      const results = [];

      const tablesToSearch = types.length > 0 
        ? types.map(type => this.getTableName(type))
        : Object.values(this.tableMap);

      // Remove duplicates
      const uniqueTables = [...new Set(tablesToSearch)];

      for (const tableName of uniqueTables) {
        let query = `
          SELECT *, '${tableName}' as table_type FROM ${tableName} 
          WHERE user_id = $1 AND (
            title ILIKE $2 OR 
            content ILIKE $2
          )
        `;
        const params = [userId, `%${searchTerm}%`];

        if (status) {
          query += ` AND status = $${params.length + 1}`;
          params.push(status);
        }

        query += ' ORDER BY created_at DESC';

        const result = await this.db.query(query, params);
        results.push(...result.rows);
      }

      // Sort all results by created_at and limit
      results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return results.slice(0, limit);

    } catch (error) {
      console.error('Error searching user items:', error);
      throw error;
    }
  }

  async filterByPriority(userId, priority, options = {}) {
    try {
      const { types = [], limit = 50 } = options;
      const results = [];

      const tablesToSearch = types.length > 0 
        ? types.map(type => this.getTableName(type))
        : Object.values(this.tableMap);

      // Remove duplicates
      const uniqueTables = [...new Set(tablesToSearch)];

      for (const tableName of uniqueTables) {
        const query = `
          SELECT *, '${tableName}' as table_type FROM ${tableName} 
          WHERE user_id = $1 AND priority = $2
          ORDER BY created_at DESC
        `;

        const result = await this.db.query(query, [userId, priority]);
        results.push(...result.rows);
      }

      // Sort all results by priority order and created_at
      const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
      results.sort((a, b) => {
        const priorityDiff = (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(b.created_at) - new Date(a.created_at);
      });

      return results.slice(0, limit);

    } catch (error) {
      console.error('Error filtering by priority:', error);
      throw error;
    }
  }

  async filterByDateRange(userId, startDate, endDate, options = {}) {
    try {
      const { types = [], limit = 50 } = options;
      const results = [];

      const tablesToSearch = types.length > 0 
        ? types.map(type => this.getTableName(type))
        : Object.values(this.tableMap);

      // Remove duplicates
      const uniqueTables = [...new Set(tablesToSearch)];

      for (const tableName of uniqueTables) {
        // Determine the date column to use for each table
        let dateColumn = 'created_at';
        if (tableName.includes('reminder')) dateColumn = 'reminder_datetime';
        else if (tableName.includes('event')) dateColumn = 'event_datetime';
        else if (tableName.includes('task')) dateColumn = 'due_datetime';
        else if (tableName.includes('health')) dateColumn = 'appointment_datetime';
        else if (tableName.includes('travel')) dateColumn = 'departure_date';
        else if (tableName.includes('creative') || tableName.includes('admin')) dateColumn = 'deadline';

        const query = `
          SELECT *, '${tableName}' as table_type FROM ${tableName} 
          WHERE user_id = $1 AND ${dateColumn} BETWEEN $2 AND $3
          ORDER BY ${dateColumn} DESC
        `;

        const result = await this.db.query(query, [userId, startDate, endDate]);
        results.push(...result.rows);
      }

      // Sort all results by date
      results.sort((a, b) => {
        const aDate = new Date(a.reminder_datetime || a.event_datetime || a.due_datetime || a.created_at);
        const bDate = new Date(b.reminder_datetime || b.event_datetime || b.due_datetime || b.created_at);
        return bDate - aDate;
      });

      return results.slice(0, limit);

    } catch (error) {
      console.error('Error filtering by date range:', error);
      throw error;
    }
  }

  // ================================
  // DASHBOARD HELPER FUNCTIONS
  // ================================

  async getUpcomingItems(userId, options = {}) {
    try {
      const { hours = 24, limit = 10 } = options;
      const endTime = new Date();
      endTime.setHours(endTime.getHours() + hours);

      const results = [];

      // Get upcoming reminders
      const reminders = await this.db.query(`
        SELECT *, 'reminder' as item_type FROM internal_reminders 
        WHERE user_id = $1 AND status = 'active' 
        AND reminder_datetime BETWEEN CURRENT_TIMESTAMP AND $2
        ORDER BY reminder_datetime ASC
      `, [userId, endTime.toISOString()]);

      // Get upcoming events
      const events = await this.db.query(`
        SELECT *, 'event' as item_type FROM internal_events 
        WHERE user_id = $1 AND status = 'active' 
        AND event_datetime BETWEEN CURRENT_TIMESTAMP AND $2
        ORDER BY event_datetime ASC
      `, [userId, endTime.toISOString()]);

      // Get due tasks
      const tasks = await this.db.query(`
        SELECT *, 'task' as item_type FROM internal_tasks 
        WHERE user_id = $1 AND status = 'active' 
        AND due_datetime BETWEEN CURRENT_TIMESTAMP AND $2
        ORDER BY due_datetime ASC
      `, [userId, endTime.toISOString()]);

      results.push(...reminders.rows, ...events.rows, ...tasks.rows);

      // Sort by datetime
      results.sort((a, b) => {
        const aTime = new Date(a.reminder_datetime || a.event_datetime || a.due_datetime);
        const bTime = new Date(b.reminder_datetime || b.event_datetime || b.due_datetime);
        return aTime - bTime;
      });

      return results.slice(0, limit);

    } catch (error) {
      console.error('Error getting upcoming items:', error);
      throw error;
    }
  }

  async getItemCounts(userId) {
    try {
      const counts = {};

      for (const [type, tableName] of Object.entries(this.tableMap)) {
        const result = await this.db.query(
          `SELECT status, COUNT(*) as count FROM ${tableName} WHERE user_id = $1 GROUP BY status`,
          [userId]
        );

        counts[type] = {};
        result.rows.forEach(row => {
          counts[type][row.status] = parseInt(row.count);
        });
      }

      return counts;

    } catch (error) {
      console.error('Error getting item counts:', error);
      throw error;
    }
  }
}

module.exports = InternalItemsCRUD;