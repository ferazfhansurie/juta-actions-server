const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

// Database connection
const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_stgYmUDC4q2r@ep-billowing-resonance-a1buwet1-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
});

// Table mappings for different item types
const ITEM_TABLES = {
  reminder: 'internal_reminders',
  event: 'internal_events', 
  task: 'internal_tasks',
  note: 'internal_notes',
  contact: 'internal_contacts',
  issue: 'internal_issues',
  learning: 'internal_learning_items',
  finance: 'internal_finance_items',
  health: 'internal_health_items',
  shopping: 'internal_shopping_items',
  travel: 'internal_travel_items',
  creative: 'internal_creative_items',
  administrative: 'internal_admin_items'
};

// Get all internal items for a user
router.get('/all/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const { status, priority, limit = 100, offset = 0 } = req.query;

    let whereClause = 'WHERE user_id = $1';
    let params = [userId];
    let paramCount = 1;

    if (status) {
      whereClause += ` AND status = $${++paramCount}`;
      params.push(status);
    }

    if (priority) {
      whereClause += ` AND priority = $${++paramCount}`;
      params.push(priority);
    }

    // Query all item types
    const queries = Object.entries(ITEM_TABLES).map(([type, table]) => {
      return db.query(
        `SELECT *, '${type}' as item_type FROM ${table} ${whereClause} ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
        [...params, limit, offset]
      );
    });

    const results = await Promise.all(queries);
    
    // Combine and sort all results
    const allItems = [];
    results.forEach((result, index) => {
      const type = Object.keys(ITEM_TABLES)[index];
      result.rows.forEach(row => {
        allItems.push({
          ...row,
          item_type: type
        });
      });
    });

    // Sort by created_at descending
    allItems.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Get total counts for each type
    const countQueries = Object.entries(ITEM_TABLES).map(([type, table]) => {
      let countWhereClause = whereClause;
      if (status || priority) {
        // Use same filters for counts
        return db.query(`SELECT COUNT(*) as count FROM ${table} ${countWhereClause}`, params.slice(0, -2));
      } else {
        return db.query(`SELECT COUNT(*) as count FROM ${table} WHERE user_id = $1`, [userId]);
      }
    });

    const countResults = await Promise.all(countQueries);
    const counts = {};
    Object.keys(ITEM_TABLES).forEach((type, index) => {
      counts[type] = parseInt(countResults[index].rows[0].count);
    });

    res.json({
      success: true,
      items: allItems,
      counts: counts,
      total: allItems.length,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: allItems.length === parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Error fetching all internal items:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get items by specific type
router.get('/type/:type/:userId', async (req, res) => {
  try {
    const { type, userId } = req.params;
    const { status, priority, limit = 50, offset = 0 } = req.query;

    if (!ITEM_TABLES[type]) {
      return res.status(400).json({ success: false, error: 'Invalid item type' });
    }

    const table = ITEM_TABLES[type];
    let whereClause = 'WHERE user_id = $1';
    let params = [userId];
    let paramCount = 1;

    if (status) {
      whereClause += ` AND status = $${++paramCount}`;
      params.push(status);
    }

    if (priority) {
      whereClause += ` AND priority = $${++paramCount}`;
      params.push(priority);
    }

    const result = await db.query(
      `SELECT * FROM ${table} ${whereClause} ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) as count FROM ${table} ${whereClause}`,
      params
    );

    res.json({
      success: true,
      items: result.rows.map(row => ({...row, item_type: type})),
      total: parseInt(countResult.rows[0].count),
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: result.rows.length === parseInt(limit)
      }
    });

  } catch (error) {
    console.error(`Error fetching ${type} items:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get dashboard summary
router.get('/dashboard/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    // Get counts by status for each type
    const summaryQueries = Object.entries(ITEM_TABLES).map(([type, table]) => {
      return db.query(
        `SELECT 
          status,
          priority,
          COUNT(*) as count
         FROM ${table} 
         WHERE user_id = $1 
         GROUP BY status, priority`,
        [userId]
      );
    });

    const summaryResults = await Promise.all(summaryQueries);
    
    const summary = {};
    Object.keys(ITEM_TABLES).forEach((type, index) => {
      summary[type] = {
        total: 0,
        byStatus: {},
        byPriority: {}
      };

      summaryResults[index].rows.forEach(row => {
        const count = parseInt(row.count);
        summary[type].total += count;
        
        if (!summary[type].byStatus[row.status]) {
          summary[type].byStatus[row.status] = 0;
        }
        summary[type].byStatus[row.status] += count;

        if (!summary[type].byPriority[row.priority]) {
          summary[type].byPriority[row.priority] = 0;
        }
        summary[type].byPriority[row.priority] += count;
      });
    });

    // Get recent items (last 10)
    const recentQueries = Object.entries(ITEM_TABLES).map(([type, table]) => {
      return db.query(
        `SELECT *, '${type}' as item_type FROM ${table} WHERE user_id = $1 ORDER BY created_at DESC LIMIT 2`,
        [userId]
      );
    });

    const recentResults = await Promise.all(recentQueries);
    const recentItems = [];
    
    recentResults.forEach(result => {
      recentItems.push(...result.rows);
    });

    // Sort and take top 10
    recentItems.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const topRecent = recentItems.slice(0, 10);

    res.json({
      success: true,
      summary: summary,
      recentItems: topRecent
    });

  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update item status
router.put('/status/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const { status, userId } = req.body;

    if (!ITEM_TABLES[type]) {
      return res.status(400).json({ success: false, error: 'Invalid item type' });
    }

    const table = ITEM_TABLES[type];
    const result = await db.query(
      `UPDATE ${table} SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 RETURNING *`,
      [status, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    res.json({
      success: true,
      item: {...result.rows[0], item_type: type}
    });

  } catch (error) {
    console.error('Error updating item status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create new internal item from action
router.post('/create/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { actionId, userId, title, content, ...additionalFields } = req.body;

    if (!ITEM_TABLES[type]) {
      return res.status(400).json({ success: false, error: 'Invalid item type' });
    }

    const table = ITEM_TABLES[type];
    
    // Build dynamic insert query based on provided fields
    const baseFields = ['action_id', 'user_id', 'title', 'content'];
    const baseValues = [actionId, userId, title, content];
    let paramCount = 4;

    const additionalFieldsList = [];
    const additionalValuesList = [];

    // Map common fields to table-specific column names
    const fieldMappings = {
      reminder: { datetime: 'reminder_datetime' },
      event: { datetime: 'event_datetime', endDatetime: 'end_datetime' },
      task: { datetime: 'due_datetime' },
      note: { datetime: 'note_datetime' },
      contact: { datetime: 'contact_datetime' },
      issue: { datetime: 'issue_datetime' },
      learning: { datetime: 'learning_datetime' },
      finance: { datetime: 'finance_datetime' },
      health: { datetime: 'health_datetime', appointmentDatetime: 'appointment_datetime' },
      shopping: { datetime: 'shopping_datetime' },
      travel: { datetime: 'travel_datetime' },
      creative: { datetime: 'creative_datetime' },
      administrative: { datetime: 'admin_datetime' }
    };

    // Add additional fields based on type and provided data
    Object.entries(additionalFields).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        const mappedKey = fieldMappings[type]?.[key] || key;
        additionalFieldsList.push(mappedKey);
        additionalValuesList.push(value);
      }
    });

    const allFields = [...baseFields, ...additionalFieldsList];
    const allValues = [...baseValues, ...additionalValuesList];
    const placeholders = allValues.map((_, index) => `$${index + 1}`);

    const insertQuery = `
      INSERT INTO ${table} (${allFields.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *
    `;

    const result = await db.query(insertQuery, allValues);

    res.json({
      success: true,
      item: {...result.rows[0], item_type: type}
    });

  } catch (error) {
    console.error('Error creating internal item:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete item
router.delete('/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const { userId } = req.query;

    if (!ITEM_TABLES[type]) {
      return res.status(400).json({ success: false, error: 'Invalid item type' });
    }

    const table = ITEM_TABLES[type];
    const result = await db.query(
      `DELETE FROM ${table} WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    res.json({
      success: true,
      message: 'Item deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting item:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search items
router.get('/search/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const { q, type, status, priority, limit = 50 } = req.query;

    if (!q) {
      return res.status(400).json({ success: false, error: 'Search query required' });
    }

    const searchTables = type && ITEM_TABLES[type] ? 
      [{ type, table: ITEM_TABLES[type] }] : 
      Object.entries(ITEM_TABLES).map(([t, table]) => ({ type: t, table }));

    let whereClause = 'WHERE user_id = $1 AND (title ILIKE $2 OR content ILIKE $2)';
    let params = [userId, `%${q}%`];
    let paramCount = 2;

    if (status) {
      whereClause += ` AND status = $${++paramCount}`;
      params.push(status);
    }

    if (priority) {
      whereClause += ` AND priority = $${++paramCount}`;
      params.push(priority);
    }

    const searchQueries = searchTables.map(({ type: t, table }) => {
      return db.query(
        `SELECT *, '${t}' as item_type FROM ${table} ${whereClause} ORDER BY created_at DESC LIMIT $${paramCount + 1}`,
        [...params, limit]
      );
    });

    const results = await Promise.all(searchQueries);
    
    const searchResults = [];
    results.forEach(result => {
      searchResults.push(...result.rows);
    });

    // Sort by relevance (title matches first, then by date)
    searchResults.sort((a, b) => {
      const aTitle = a.title.toLowerCase().includes(q.toLowerCase());
      const bTitle = b.title.toLowerCase().includes(q.toLowerCase());
      
      if (aTitle && !bTitle) return -1;
      if (!aTitle && bTitle) return 1;
      
      return new Date(b.created_at) - new Date(a.created_at);
    });

    res.json({
      success: true,
      results: searchResults.slice(0, limit),
      query: q,
      total: searchResults.length
    });

  } catch (error) {
    console.error('Error searching items:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;