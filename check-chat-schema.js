/**
 * Script to check the current schema of ChatMessages table
 * Run this with: node check-chat-schema.js
 */

require('dotenv').config();
const { sequelize } = require('./src/models');

async function checkSchema() {
  try {
    console.log('🔍 Checking ChatMessages table schema...\n');
    
    // Check groupId column
    const [groupIdInfo] = await sequelize.query(`
      SHOW COLUMNS FROM ChatMessages WHERE Field = 'groupId'
    `);
    
    if (groupIdInfo.length === 0) {
      console.error('❌ groupId column not found!');
      process.exit(1);
    }
    
    console.log('📋 groupId Column Info:');
    console.log(JSON.stringify(groupIdInfo[0], null, 2));
    console.log('\n');
    
    // Check receiverId column
    const [receiverIdInfo] = await sequelize.query(`
      SHOW COLUMNS FROM ChatMessages WHERE Field = 'receiverId'
    `);
    
    if (receiverIdInfo.length === 0) {
      console.log('⚠️  receiverId column not found!');
    } else {
      console.log('📋 receiverId Column Info:');
      console.log(JSON.stringify(receiverIdInfo[0], null, 2));
      console.log('\n');
    }
    
    // Check all columns
    const [allColumns] = await sequelize.query(`
      SHOW COLUMNS FROM ChatMessages
    `);
    
    console.log('📋 All ChatMessages Columns:');
    allColumns.forEach(col => {
      console.log(`  - ${col.Field}: ${col.Type} ${col.Null === 'YES' ? '(NULLABLE)' : '(NOT NULL)'}`);
    });
    console.log('\n');
    
    // Check foreign keys
    const [foreignKeys] = await sequelize.query(`
      SELECT 
        CONSTRAINT_NAME,
        COLUMN_NAME,
        REFERENCED_TABLE_NAME,
        REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ChatMessages'
      AND REFERENCED_TABLE_NAME IS NOT NULL
    `);
    
    console.log('📋 Foreign Keys:');
    foreignKeys.forEach(fk => {
      console.log(`  - ${fk.CONSTRAINT_NAME}: ${fk.COLUMN_NAME} -> ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`);
    });
    console.log('\n');
    
    // Summary
    const isGroupIdNullable = groupIdInfo[0].Null === 'YES';
    const hasReceiverId = receiverIdInfo.length > 0;
    
    console.log('📊 Summary:');
    console.log(`  - groupId is nullable: ${isGroupIdNullable ? '✅ YES' : '❌ NO'}`);
    console.log(`  - receiverId exists: ${hasReceiverId ? '✅ YES' : '❌ NO'}`);
    
    if (!isGroupIdNullable) {
      console.log('\n⚠️  ISSUE FOUND: groupId is NOT NULL. This needs to be fixed!');
      console.log('   Run: node fix-chat-groupId-direct-sql.js');
    } else {
      console.log('\n✅ Schema looks good!');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  }
}

checkSchema();

