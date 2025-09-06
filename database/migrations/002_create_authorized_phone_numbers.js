const { Pool } = require('pg');

class Migration002CreateAuthorizedPhoneNumbers {
  constructor(db) {
    this.db = db;
    this.migrationName = '002_create_authorized_phone_numbers';
  }

  async up() {
    console.log(`Running migration: ${this.migrationName}`);
    
    try {
      // Create authorized_phone_numbers table
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS authorized_phone_numbers (
          id SERIAL PRIMARY KEY,
          phone_number VARCHAR(20) UNIQUE NOT NULL,
          name VARCHAR(255),
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert the existing authorized phone numbers
      const authorizedNumbers = [
        { phone: '+601121677522', name: 'Firaz' },
        { phone: '+601121677672', name: 'Admin 2' },
        { phone: '+60126268707', name: 'Admin 3' },
        { phone: '+60126851668', name: 'Admin 4' }
      ];

      for (const { phone, name } of authorizedNumbers) {
        await this.db.query(`
          INSERT INTO authorized_phone_numbers (phone_number, name, is_active) 
          VALUES ($1, $2, $3) 
          ON CONFLICT (phone_number) DO NOTHING
        `, [phone, name, true]);
      }
      
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
      // Drop authorized_phone_numbers table
      await this.db.query(`DROP TABLE IF EXISTS authorized_phone_numbers CASCADE`);
      
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

module.exports = Migration002CreateAuthorizedPhoneNumbers;