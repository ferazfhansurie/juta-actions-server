const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

class DatabaseMigrator {
  constructor(databaseUrl) {
    this.db = new Pool({
      connectionString: databaseUrl
    });
  }

  async runMigrations() {
    try {
      console.log('🚀 Starting database migrations...');

      // Create migrations table if it doesn't exist
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS migrations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) UNIQUE NOT NULL,
          executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Get all migration files
      const migrationsDir = path.join(__dirname, 'migrations');
      const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(file => file.endsWith('.js'))
        .sort();

      console.log(`📁 Found ${migrationFiles.length} migration files`);

      for (const file of migrationFiles) {
        const MigrationClass = require(path.join(migrationsDir, file));
        const migration = new MigrationClass(this.db);

        // Check if migration was already executed
        const isExecuted = await migration.isExecuted();
        
        if (!isExecuted) {
          console.log(`⚡ Running migration: ${file}`);
          await migration.up();
          console.log(`✅ Migration ${file} completed`);
        } else {
          console.log(`⏭️  Migration ${file} already executed, skipping`);
        }
      }

      console.log('🎉 All migrations completed successfully!');
      return true;
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }

  async rollbackLastMigration() {
    try {
      console.log('🔄 Rolling back last migration...');

      // Get the last executed migration
      const result = await this.db.query(
        'SELECT name FROM migrations ORDER BY executed_at DESC LIMIT 1'
      );

      if (result.rows.length === 0) {
        console.log('📭 No migrations to rollback');
        return true;
      }

      const lastMigrationName = result.rows[0].name;
      const migrationFile = `${lastMigrationName}.js`;
      const migrationPath = path.join(__dirname, 'migrations', migrationFile);

      if (fs.existsSync(migrationPath)) {
        const MigrationClass = require(migrationPath);
        const migration = new MigrationClass(this.db);
        
        console.log(`⚡ Rolling back: ${migrationFile}`);
        await migration.down();
        console.log(`✅ Rollback completed for ${migrationFile}`);
      } else {
        console.error(`❌ Migration file not found: ${migrationFile}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error('❌ Rollback failed:', error);
      throw error;
    }
  }

  async getMigrationStatus() {
    try {
      const result = await this.db.query(
        'SELECT name, executed_at FROM migrations ORDER BY executed_at DESC'
      );
      
      console.log('📊 Migration Status:');
      if (result.rows.length === 0) {
        console.log('  No migrations executed yet');
      } else {
        result.rows.forEach(row => {
          console.log(`  ✅ ${row.name} - ${row.executed_at}`);
        });
      }
      
      return result.rows;
    } catch (error) {
      console.error('❌ Error getting migration status:', error);
      throw error;
    }
  }

  async close() {
    await this.db.end();
  }
}

module.exports = DatabaseMigrator;