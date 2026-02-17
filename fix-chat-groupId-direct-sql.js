/**
 * Direct SQL script to fix ChatMessages table to allow NULL groupId
 * This uses raw SQL to ensure the change takes effect
 * Run this with: node fix-chat-groupId-direct-sql.js
 */

require('dotenv').config();
const { sequelize } = require('./src/models');

async function fixGroupIdNullableDirect() {
  try {
    console.log('🔄 Fixing ChatMessages table to allow NULL groupId using direct SQL...');
    
    // First, check current column definition
    const [results] = await sequelize.query(`
      SHOW COLUMNS FROM ChatMessages WHERE Field = 'groupId'
    `);
    
    if (results.length === 0) {
      console.error('❌ groupId column not found in ChatMessages table');
      process.exit(1);
    }
    
    console.log('📋 Current groupId column definition:', results[0]);
    
    // Check if receiverId column exists
    const [receiverIdCheck] = await sequelize.query(`
      SHOW COLUMNS FROM ChatMessages WHERE Field = 'receiverId'
    `);
    
    if (receiverIdCheck.length === 0) {
      console.log('📝 Adding receiverId column...');
      await sequelize.query(`
        ALTER TABLE ChatMessages 
        ADD COLUMN receiverId INT NULL,
        ADD INDEX idx_receiverId (receiverId),
        ADD INDEX idx_sender_receiver_created (senderId, receiverId, createdAt),
        ADD CONSTRAINT fk_chat_receiver 
          FOREIGN KEY (receiverId) REFERENCES Users(id) 
          ON UPDATE CASCADE ON DELETE SET NULL
      `);
      console.log('✅ receiverId column added');
    } else {
      console.log('✅ receiverId column already exists');
    }
    
    // Make groupId nullable using direct SQL
    console.log('📝 Making groupId nullable using ALTER TABLE...');
    
    // First, check if there's a foreign key constraint
    const [fkCheck] = await sequelize.query(`
      SELECT CONSTRAINT_NAME 
      FROM information_schema.KEY_COLUMN_USAGE 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'ChatMessages' 
      AND COLUMN_NAME = 'groupId'
      AND CONSTRAINT_NAME != 'PRIMARY'
    `);
    
    // Drop foreign key if it exists (we'll recreate it)
    if (fkCheck.length > 0) {
      const fkName = fkCheck[0].CONSTRAINT_NAME;
      console.log(`📝 Dropping foreign key constraint: ${fkName}`);
      await sequelize.query(`
        ALTER TABLE ChatMessages DROP FOREIGN KEY ${fkName}
      `);
    }
    
    // Now modify the column to allow NULL
    await sequelize.query(`
      ALTER TABLE ChatMessages 
      MODIFY COLUMN groupId INT NULL
    `);
    
    // Recreate foreign key constraint
    console.log('📝 Recreating foreign key constraint...');
    await sequelize.query(`
      ALTER TABLE ChatMessages 
      ADD CONSTRAINT fk_chat_group 
        FOREIGN KEY (groupId) REFERENCES Groups(id) 
        ON UPDATE CASCADE ON DELETE CASCADE
    `).catch(err => {
      // Foreign key might already exist, that's okay
      if (err.message.includes('Duplicate')) {
        console.log('⚠️  Foreign key already exists, skipping...');
      } else {
        throw err;
      }
    });
    
    // Verify the change
    const [verifyResults] = await sequelize.query(`
      SHOW COLUMNS FROM ChatMessages WHERE Field = 'groupId'
    `);
    
    console.log('📋 Updated groupId column definition:', verifyResults[0]);
    
    if (verifyResults[0].Null === 'YES') {
      console.log('✅ groupId is now nullable!');
    } else {
      console.error('❌ groupId is still NOT NULL. The change may not have taken effect.');
      process.exit(1);
    }
    
    console.log('✅ Database schema fixed successfully!');
    console.log('✅ Private messages can now be stored with groupId = NULL');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  }
}

fixGroupIdNullableDirect();

