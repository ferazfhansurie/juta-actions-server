const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

class Migration001CreateInternalItemsTables {
  constructor(db) {
    this.db = db;
    this.migrationName = '001_create_internal_items_tables';
  }

  async up() {
    console.log(`Running migration: ${this.migrationName}`);
    
    try {
      // Read the schema SQL file
      const schemaPath = path.join(__dirname, '../schema.sql');
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      
      // Execute the schema
      await this.db.query(schemaSql);
      
      // Create migrations tracking table if it doesn't exist
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS migrations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) UNIQUE NOT NULL,
          executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Record this migration
      await this.db.query(
        'INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
        [this.migrationName]
      );
      
      console.log(`✅ Migration ${this.migrationName} completed successfully`);
      return true;
    } catch (error) {
      console.error(`❌ Migration ${this.migrationName} failed:`, error);
      throw error;
    }
  }

  async down() {
    console.log(`Rolling back migration: ${this.migrationName}`);
    
    try {
      // Drop all internal item tables
      const tables = [
        'internal_reminders',
        'internal_events', 
        'internal_tasks',
        'internal_notes',
        'internal_contacts',
        'internal_issues',
        'internal_learning_items',
        'internal_finance_items',
        'internal_health_items',
        'internal_shopping_items',
        'internal_travel_items',
        'internal_creative_items',
        'internal_admin_items'
      ];

      for (const table of tables) {
        await this.db.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
      }
      
      // Remove migration record
      await this.db.query(
        'DELETE FROM migrations WHERE name = $1',
        [this.migrationName]
      );
      
      console.log(`✅ Migration ${this.migrationName} rollback completed`);
      return true;
    } catch (error) {
      console.error(`❌ Migration ${this.migrationName} rollback failed:`, error);
      throw error;
    }
  }

  async isExecuted() {
    try {
      const result = await this.db.query(
        'SELECT 1 FROM migrations WHERE name = $1',
        [this.migrationName]
      );
      return result.rows.length > 0;
    } catch (error) {
      // If migrations table doesn't exist, this migration hasn't run
      return false;
    }
  }
}

module.exports = Migration001CreateInternalItemsTables;