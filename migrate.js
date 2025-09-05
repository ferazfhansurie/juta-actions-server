#!/usr/bin/env node

/**
 * Database Migration CLI Tool
 * 
 * Usage:
 *   node migrate.js up       - Run all pending migrations
 *   node migrate.js down     - Rollback the last migration
 *   node migrate.js status   - Show migration status
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const DatabaseMigrator = require('./database/migrator');

const command = process.argv[2] || 'up';

async function main() {
  const databaseUrl = process.env.DATABASE_URL ;
  
  const migrator = new DatabaseMigrator(databaseUrl);

  try {
    console.log('🚀 Internal Task Management System - Database Migration Tool');
    console.log('===========================================================');

    switch (command) {
      case 'up':
        console.log('📈 Running migrations...');
        await migrator.runMigrations();
        console.log('✅ All migrations completed successfully!');
        break;

      case 'down':
        console.log('📉 Rolling back last migration...');
        await migrator.rollbackLastMigration();
        console.log('✅ Rollback completed!');
        break;

      case 'status':
        console.log('📊 Getting migration status...');
        await migrator.getMigrationStatus();
        break;

      default:
        console.log('❌ Unknown command. Use: up, down, or status');
        process.exit(1);
    }

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await migrator.close();
  }
}

main();