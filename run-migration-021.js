/**
 * Script to run migration 021-add-receiverId-to-chat-messages.js
 * Run this with: node run-migration-021.js
 */

require('dotenv').config();
const { sequelize } = require('./src/models');
const path = require('path');
const fs = require('fs');

async function runMigration() {
  try {
    console.log('🔄 Running migration 021-add-receiverId-to-chat-messages.js...');
    
    // Import the migration
    const migration = require('./src/migrations/021-add-receiverId-to-chat-messages.js');
    
    // Get queryInterface from sequelize
    const queryInterface = sequelize.getQueryInterface();
    
    // Run the migration
    await migration.up(queryInterface, sequelize.Sequelize);
    
    console.log('✅ Migration completed successfully!');
    console.log('✅ Added receiverId column to ChatMessages table');
    console.log('✅ Made groupId nullable for private messages');
    console.log('✅ Added indexes for better performance');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  }
}

runMigration();

