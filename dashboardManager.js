const { Pool } = require('pg');

class DashboardManager {
  constructor(db, internalItemsCRUD) {
    this.db = db;
    this.crud = internalItemsCRUD;
  }

  // ================================
  // MAIN DASHBOARD DATA FUNCTION
  // ================================

  async getUserDashboardData(userId) {
    try {
      console.log(`📊 Getting dashboard data for user ${userId}`);

      const dashboardData = {
        summary: await this.getDashboardSummary(userId),
        upcomingItems: await this.getUpcomingItems(userId),
        overdueTasks: await this.getOverdueTasks(userId),
        todayEvents: await this.getTodayEvents(userId),
        recentActivity: await this.getRecentActivity(userId),
        actionStats: await this.getActionStats(userId),
        priorityBreakdown: await this.getPriorityBreakdown(userId),
        completionStats: await this.getCompletionStats(userId)
      };

      console.log(`✅ Dashboard data retrieved for user ${userId}`);
      return dashboardData;

    } catch (error) {
      console.error('Error getting dashboard data:', error);
      throw error;
    }
  }

  // ================================
  // DASHBOARD SUMMARY
  // ================================

  async getDashboardSummary(userId) {
    try {
      const summary = {};

      // Get counts for each item type
      const itemTypes = [
        { key: 'reminders', table: 'internal_reminders' },
        { key: 'events', table: 'internal_events' },
        { key: 'tasks', table: 'internal_tasks' },
        { key: 'notes', table: 'internal_notes' },
        { key: 'contacts', table: 'internal_contacts' },
        { key: 'issues', table: 'internal_issues' },
        { key: 'learning', table: 'internal_learning_items' },
        { key: 'finance', table: 'internal_finance_items' },
        { key: 'health', table: 'internal_health_items' },
        { key: 'shopping', table: 'internal_shopping_items' },
        { key: 'travel', table: 'internal_travel_items' },
        { key: 'creative', table: 'internal_creative_items' },
        { key: 'admin', table: 'internal_admin_items' }
      ];

      for (const itemType of itemTypes) {
        const result = await this.db.query(
          `SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'active') as active,
            COUNT(*) FILTER (WHERE status = 'completed') as completed,
            COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled
           FROM ${itemType.table} WHERE user_id = $1`,
          [userId]
        );

        summary[itemType.key] = {
          total: parseInt(result.rows[0].total || 0),
          active: parseInt(result.rows[0].active || 0),
          completed: parseInt(result.rows[0].completed || 0),
          cancelled: parseInt(result.rows[0].cancelled || 0)
        };
      }

      // Calculate totals across all types
      summary.totals = {
        total: Object.values(summary).reduce((sum, item) => sum + item.total, 0),
        active: Object.values(summary).reduce((sum, item) => sum + item.active, 0),
        completed: Object.values(summary).reduce((sum, item) => sum + item.completed, 0),
        cancelled: Object.values(summary).reduce((sum, item) => sum + item.cancelled, 0)
      };

      return summary;

    } catch (error) {
      console.error('Error getting dashboard summary:', error);
      throw error;
    }
  }

  // ================================
  // UPCOMING ITEMS
  // ================================

  async getUpcomingItems(userId, hours = 24) {
    try {
      const endTime = new Date();
      endTime.setHours(endTime.getHours() + hours);

      const upcomingItems = [];

      // Get upcoming reminders
      const reminders = await this.db.query(`
        SELECT 
          id, title, content, reminder_datetime as datetime, priority,
          'reminder' as type, 'internal_reminders' as table_name
        FROM internal_reminders 
        WHERE user_id = $1 
          AND status = 'active' 
          AND reminder_datetime BETWEEN CURRENT_TIMESTAMP AND $2
        ORDER BY reminder_datetime ASC
      `, [userId, endTime.toISOString()]);

      // Get upcoming events
      const events = await this.db.query(`
        SELECT 
          id, title, content, event_datetime as datetime, priority, location,
          'event' as type, 'internal_events' as table_name
        FROM internal_events 
        WHERE user_id = $1 
          AND status = 'active' 
          AND event_datetime BETWEEN CURRENT_TIMESTAMP AND $2
        ORDER BY event_datetime ASC
      `, [userId, endTime.toISOString()]);

      // Get due tasks
      const tasks = await this.db.query(`
        SELECT 
          id, title, content, due_datetime as datetime, priority,
          'task' as type, 'internal_tasks' as table_name
        FROM internal_tasks 
        WHERE user_id = $1 
          AND status = 'active' 
          AND due_datetime BETWEEN CURRENT_TIMESTAMP AND $2
        ORDER BY due_datetime ASC
      `, [userId, endTime.toISOString()]);

      // Get upcoming health appointments
      const healthItems = await this.db.query(`
        SELECT 
          id, title, content, appointment_datetime as datetime, priority,
          'health' as type, 'internal_health_items' as table_name
        FROM internal_health_items 
        WHERE user_id = $1 
          AND status = 'active' 
          AND appointment_datetime BETWEEN CURRENT_TIMESTAMP AND $2
        ORDER BY appointment_datetime ASC
      `, [userId, endTime.toISOString()]);

      upcomingItems.push(...reminders.rows, ...events.rows, ...tasks.rows, ...healthItems.rows);

      // Sort by datetime
      upcomingItems.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

      return upcomingItems.slice(0, 10); // Limit to 10 items

    } catch (error) {
      console.error('Error getting upcoming items:', error);
      throw error;
    }
  }

  // ================================
  // OVERDUE TASKS
  // ================================

  async getOverdueTasks(userId) {
    try {
      const result = await this.db.query(`
        SELECT 
          id, title, content, due_datetime, priority, task_type,
          EXTRACT(DAY FROM (CURRENT_TIMESTAMP - due_datetime)) as days_overdue
        FROM internal_tasks 
        WHERE user_id = $1 
          AND status = 'active' 
          AND due_datetime < CURRENT_TIMESTAMP
        ORDER BY due_datetime ASC
      `, [userId]);

      return result.rows.map(task => ({
        ...task,
        days_overdue: parseInt(task.days_overdue || 0),
        type: 'task'
      }));

    } catch (error) {
      console.error('Error getting overdue tasks:', error);
      throw error;
    }
  }

  // ================================
  // TODAY'S EVENTS
  // ================================

  async getTodayEvents(userId) {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);

      const result = await this.db.query(`
        SELECT 
          id, title, content, event_datetime, end_datetime, 
          location, priority, event_type, attendees
        FROM internal_events 
        WHERE user_id = $1 
          AND status = 'active' 
          AND event_datetime BETWEEN $2 AND $3
        ORDER BY event_datetime ASC
      `, [userId, startOfDay.toISOString(), endOfDay.toISOString()]);

      return result.rows.map(event => ({
        ...event,
        type: 'event'
      }));

    } catch (error) {
      console.error('Error getting today events:', error);
      throw error;
    }
  }

  // ================================
  // RECENT ACTIVITY
  // ================================

  async getRecentActivity(userId, limit = 20) {
    try {
      const activities = [];

      // Define tables to check for recent activity
      const tables = [
        { name: 'internal_reminders', type: 'reminder', dateField: 'created_at' },
        { name: 'internal_events', type: 'event', dateField: 'created_at' },
        { name: 'internal_tasks', type: 'task', dateField: 'created_at' },
        { name: 'internal_notes', type: 'note', dateField: 'created_at' },
        { name: 'internal_contacts', type: 'contact', dateField: 'created_at' },
        { name: 'internal_issues', type: 'issue', dateField: 'created_at' }
      ];

      for (const table of tables) {
        const result = await this.db.query(`
          SELECT 
            id, title, content, status, priority, ${table.dateField} as activity_date,
            '${table.type}' as activity_type,
            CASE 
              WHEN status = 'completed' THEN 'completed'
              WHEN status = 'cancelled' THEN 'cancelled'
              WHEN created_at > (CURRENT_TIMESTAMP - INTERVAL '1 hour') THEN 'created'
              ELSE 'updated'
            END as activity_action
          FROM ${table.name} 
          WHERE user_id = $1 
            AND (
              created_at > (CURRENT_TIMESTAMP - INTERVAL '7 days') OR
              updated_at > (CURRENT_TIMESTAMP - INTERVAL '7 days')
            )
          ORDER BY GREATEST(created_at, updated_at) DESC
          LIMIT 5
        `, [userId]);

        activities.push(...result.rows);
      }

      // Sort all activities by date and limit
      activities.sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date));

      return activities.slice(0, limit);

    } catch (error) {
      console.error('Error getting recent activity:', error);
      throw error;
    }
  }

  // ================================
  // ACTION STATS
  // ================================

  async getActionStats(userId) {
    try {
      const result = await this.db.query(`
        SELECT 
          type,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'approved') as approved,
          COUNT(*) FILTER (WHERE status = 'rejected') as rejected
        FROM ai_actions 
        WHERE user_id = $1 
          AND created_at > (CURRENT_TIMESTAMP - INTERVAL '30 days')
        GROUP BY type
        ORDER BY total DESC
      `, [userId]);

      const stats = {
        byType: result.rows,
        totals: {
          total: result.rows.reduce((sum, row) => sum + parseInt(row.total), 0),
          pending: result.rows.reduce((sum, row) => sum + parseInt(row.pending), 0),
          approved: result.rows.reduce((sum, row) => sum + parseInt(row.approved), 0),
          rejected: result.rows.reduce((sum, row) => sum + parseInt(row.rejected), 0)
        }
      };

      // Calculate approval rate
      if (stats.totals.total > 0) {
        stats.totals.approvalRate = ((stats.totals.approved / (stats.totals.approved + stats.totals.rejected)) * 100).toFixed(1);
      } else {
        stats.totals.approvalRate = 0;
      }

      return stats;

    } catch (error) {
      console.error('Error getting action stats:', error);
      throw error;
    }
  }

  // ================================
  // PRIORITY BREAKDOWN
  // ================================

  async getPriorityBreakdown(userId) {
    try {
      const breakdown = {
        urgent: 0,
        high: 0,
        medium: 0,
        low: 0
      };

      // Define tables to check
      const tables = [
        'internal_reminders', 'internal_events', 'internal_tasks',
        'internal_notes', 'internal_contacts', 'internal_issues',
        'internal_learning_items', 'internal_finance_items',
        'internal_health_items', 'internal_shopping_items',
        'internal_travel_items', 'internal_creative_items',
        'internal_admin_items'
      ];

      for (const table of tables) {
        const result = await this.db.query(`
          SELECT 
            priority,
            COUNT(*) as count
          FROM ${table}
          WHERE user_id = $1 AND status = 'active'
          GROUP BY priority
        `, [userId]);

        result.rows.forEach(row => {
          if (breakdown.hasOwnProperty(row.priority)) {
            breakdown[row.priority] += parseInt(row.count);
          }
        });
      }

      return breakdown;

    } catch (error) {
      console.error('Error getting priority breakdown:', error);
      throw error;
    }
  }

  // ================================
  // COMPLETION STATS
  // ================================

  async getCompletionStats(userId) {
    try {
      // Get completion stats for the last 30 days
      const result = await this.db.query(`
        SELECT 
          DATE(updated_at) as completion_date,
          COUNT(*) as completed_count
        FROM (
          SELECT updated_at FROM internal_reminders WHERE user_id = $1 AND status = 'completed' AND updated_at > (CURRENT_TIMESTAMP - INTERVAL '30 days')
          UNION ALL
          SELECT updated_at FROM internal_events WHERE user_id = $1 AND status = 'completed' AND updated_at > (CURRENT_TIMESTAMP - INTERVAL '30 days')
          UNION ALL
          SELECT updated_at FROM internal_tasks WHERE user_id = $1 AND status = 'completed' AND updated_at > (CURRENT_TIMESTAMP - INTERVAL '30 days')
          UNION ALL
          SELECT updated_at FROM internal_notes WHERE user_id = $1 AND status = 'archived' AND updated_at > (CURRENT_TIMESTAMP - INTERVAL '30 days')
          UNION ALL
          SELECT updated_at FROM internal_contacts WHERE user_id = $1 AND status = 'completed' AND updated_at > (CURRENT_TIMESTAMP - INTERVAL '30 days')
          UNION ALL
          SELECT updated_at FROM internal_issues WHERE user_id = $1 AND status = 'resolved' AND updated_at > (CURRENT_TIMESTAMP - INTERVAL '30 days')
          UNION ALL
          SELECT updated_at FROM internal_learning_items WHERE user_id = $1 AND status = 'completed' AND updated_at > (CURRENT_TIMESTAMP - INTERVAL '30 days')
          UNION ALL
          SELECT updated_at FROM internal_finance_items WHERE user_id = $1 AND status = 'completed' AND updated_at > (CURRENT_TIMESTAMP - INTERVAL '30 days')
          UNION ALL
          SELECT updated_at FROM internal_health_items WHERE user_id = $1 AND status = 'completed' AND updated_at > (CURRENT_TIMESTAMP - INTERVAL '30 days')
          UNION ALL
          SELECT updated_at FROM internal_shopping_items WHERE user_id = $1 AND status = 'completed' AND updated_at > (CURRENT_TIMESTAMP - INTERVAL '30 days')
          UNION ALL
          SELECT updated_at FROM internal_travel_items WHERE user_id = $1 AND status = 'completed' AND updated_at > (CURRENT_TIMESTAMP - INTERVAL '30 days')
          UNION ALL
          SELECT updated_at FROM internal_creative_items WHERE user_id = $1 AND status = 'completed' AND updated_at > (CURRENT_TIMESTAMP - INTERVAL '30 days')
          UNION ALL
          SELECT updated_at FROM internal_admin_items WHERE user_id = $1 AND status = 'completed' AND updated_at > (CURRENT_TIMESTAMP - INTERVAL '30 days')
        ) all_completions
        GROUP BY DATE(updated_at)
        ORDER BY completion_date DESC
      `, [userId]);

      // Calculate daily averages and totals
      const dailyStats = result.rows;
      const totalCompletions = dailyStats.reduce((sum, day) => sum + parseInt(day.completed_count), 0);
      const averagePerDay = dailyStats.length > 0 ? (totalCompletions / 30).toFixed(1) : 0;

      // Get this week vs last week comparison
      const thisWeekResult = await this.db.query(`
        SELECT COUNT(*) as this_week_count
        FROM (
          SELECT updated_at FROM internal_reminders WHERE user_id = $1 AND status = 'completed' AND updated_at > (CURRENT_TIMESTAMP - INTERVAL '7 days')
          UNION ALL
          SELECT updated_at FROM internal_events WHERE user_id = $1 AND status = 'completed' AND updated_at > (CURRENT_TIMESTAMP - INTERVAL '7 days')
          UNION ALL
          SELECT updated_at FROM internal_tasks WHERE user_id = $1 AND status = 'completed' AND updated_at > (CURRENT_TIMESTAMP - INTERVAL '7 days')
          UNION ALL
          SELECT updated_at FROM internal_issues WHERE user_id = $1 AND status = 'resolved' AND updated_at > (CURRENT_TIMESTAMP - INTERVAL '7 days')
        ) this_week_completions
      `, [userId]);

      const lastWeekResult = await this.db.query(`
        SELECT COUNT(*) as last_week_count
        FROM (
          SELECT updated_at FROM internal_reminders WHERE user_id = $1 AND status = 'completed' AND updated_at BETWEEN (CURRENT_TIMESTAMP - INTERVAL '14 days') AND (CURRENT_TIMESTAMP - INTERVAL '7 days')
          UNION ALL
          SELECT updated_at FROM internal_events WHERE user_id = $1 AND status = 'completed' AND updated_at BETWEEN (CURRENT_TIMESTAMP - INTERVAL '14 days') AND (CURRENT_TIMESTAMP - INTERVAL '7 days')
          UNION ALL
          SELECT updated_at FROM internal_tasks WHERE user_id = $1 AND status = 'completed' AND updated_at BETWEEN (CURRENT_TIMESTAMP - INTERVAL '14 days') AND (CURRENT_TIMESTAMP - INTERVAL '7 days')
          UNION ALL
          SELECT updated_at FROM internal_issues WHERE user_id = $1 AND status = 'resolved' AND updated_at BETWEEN (CURRENT_TIMESTAMP - INTERVAL '14 days') AND (CURRENT_TIMESTAMP - INTERVAL '7 days')
        ) last_week_completions
      `, [userId]);

      const thisWeekCount = parseInt(thisWeekResult.rows[0].this_week_count || 0);
      const lastWeekCount = parseInt(lastWeekResult.rows[0].last_week_count || 0);
      
      let weeklyTrend = 0;
      if (lastWeekCount > 0) {
        weeklyTrend = ((thisWeekCount - lastWeekCount) / lastWeekCount * 100).toFixed(1);
      } else if (thisWeekCount > 0) {
        weeklyTrend = 100;
      }

      return {
        totalCompletions,
        averagePerDay: parseFloat(averagePerDay),
        dailyStats,
        thisWeekCount,
        lastWeekCount,
        weeklyTrend: parseFloat(weeklyTrend)
      };

    } catch (error) {
      console.error('Error getting completion stats:', error);
      throw error;
    }
  }

  // ================================
  // HELPER FUNCTIONS
  // ================================

  async getQuickStats(userId) {
    try {
      const stats = {
        pendingActions: 0,
        activeItems: 0,
        overdueItems: 0,
        completedToday: 0
      };

      // Pending AI actions
      const pendingResult = await this.db.query(
        'SELECT COUNT(*) as count FROM ai_actions WHERE user_id = $1 AND status = $2',
        [userId, 'pending']
      );
      stats.pendingActions = parseInt(pendingResult.rows[0].count || 0);

      // Active internal items (sum across all tables)
      const activeResult = await this.db.query(`
        SELECT SUM(active_count) as total_active FROM (
          SELECT COUNT(*) as active_count FROM internal_reminders WHERE user_id = $1 AND status = 'active'
          UNION ALL
          SELECT COUNT(*) FROM internal_events WHERE user_id = $1 AND status = 'active'
          UNION ALL
          SELECT COUNT(*) FROM internal_tasks WHERE user_id = $1 AND status = 'active'
          UNION ALL
          SELECT COUNT(*) FROM internal_notes WHERE user_id = $1 AND status = 'active'
          UNION ALL
          SELECT COUNT(*) FROM internal_contacts WHERE user_id = $1 AND status = 'active'
          UNION ALL
          SELECT COUNT(*) FROM internal_issues WHERE user_id = $1 AND status = 'active'
          UNION ALL
          SELECT COUNT(*) FROM internal_learning_items WHERE user_id = $1 AND status = 'active'
          UNION ALL
          SELECT COUNT(*) FROM internal_finance_items WHERE user_id = $1 AND status = 'active'
          UNION ALL
          SELECT COUNT(*) FROM internal_health_items WHERE user_id = $1 AND status = 'active'
          UNION ALL
          SELECT COUNT(*) FROM internal_shopping_items WHERE user_id = $1 AND status = 'active'
          UNION ALL
          SELECT COUNT(*) FROM internal_travel_items WHERE user_id = $1 AND status = 'active'
          UNION ALL
          SELECT COUNT(*) FROM internal_creative_items WHERE user_id = $1 AND status = 'active'
          UNION ALL
          SELECT COUNT(*) FROM internal_admin_items WHERE user_id = $1 AND status = 'active'
        ) all_active_counts
      `, [userId]);
      stats.activeItems = parseInt(activeResult.rows[0].total_active || 0);

      // Overdue items (tasks and reminders)
      const overdueResult = await this.db.query(`
        SELECT SUM(overdue_count) as total_overdue FROM (
          SELECT COUNT(*) as overdue_count FROM internal_tasks 
          WHERE user_id = $1 AND status = 'active' AND due_datetime < CURRENT_TIMESTAMP
          UNION ALL
          SELECT COUNT(*) FROM internal_reminders 
          WHERE user_id = $1 AND status = 'active' AND reminder_datetime < CURRENT_TIMESTAMP
        ) all_overdue_counts
      `, [userId]);
      stats.overdueItems = parseInt(overdueResult.rows[0].total_overdue || 0);

      // Completed today
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const completedTodayResult = await this.db.query(`
        SELECT SUM(completed_count) as total_completed FROM (
          SELECT COUNT(*) as completed_count FROM internal_reminders 
          WHERE user_id = $1 AND status = 'completed' AND updated_at >= $2
          UNION ALL
          SELECT COUNT(*) FROM internal_events 
          WHERE user_id = $1 AND status = 'completed' AND updated_at >= $2
          UNION ALL
          SELECT COUNT(*) FROM internal_tasks 
          WHERE user_id = $1 AND status = 'completed' AND updated_at >= $2
          UNION ALL
          SELECT COUNT(*) FROM internal_issues 
          WHERE user_id = $1 AND status = 'resolved' AND updated_at >= $2
        ) all_completed_counts
      `, [userId, startOfDay.toISOString()]);
      stats.completedToday = parseInt(completedTodayResult.rows[0].total_completed || 0);

      return stats;

    } catch (error) {
      console.error('Error getting quick stats:', error);
      throw error;
    }
  }
}

module.exports = DashboardManager;