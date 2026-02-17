/**
 * Test script to directly test inserting a private message
 * This will help us verify if the database truly accepts NULL groupId
 * Run this with: node test-private-message-insert.js
 */

require('dotenv').config();
const { sequelize, ChatMessage, User } = require('./src/models');

async function testPrivateMessageInsert() {
  try {
    console.log('🧪 Testing private message insertion...\n');
    
    // Get a test user
    const testUser = await User.findOne({
      where: { status: 'active' },
      attributes: ['id', 'name', 'role']
    });
    
    if (!testUser) {
      console.error('❌ No active users found in database');
      process.exit(1);
    }
    
    console.log(`📋 Using test user: ${testUser.name} (ID: ${testUser.id}, Role: ${testUser.role})\n`);
    
    // Try to create a private message with groupId = null
    console.log('🔄 Attempting to create private message with groupId = NULL...');
    
    try {
      const testMessage = await ChatMessage.create({
        groupId: null,
        senderId: testUser.id,
        receiverId: testUser.id, // Sending to self for test (will be cleaned up)
        message: 'Test private message - can be deleted',
        type: 'text'
      });
      
      console.log('✅ SUCCESS! Private message created:');
      console.log(`   ID: ${testMessage.id}`);
      console.log(`   groupId: ${testMessage.groupId}`);
      console.log(`   senderId: ${testMessage.senderId}`);
      console.log(`   receiverId: ${testMessage.receiverId}`);
      console.log(`   message: ${testMessage.message}\n`);
      
      // Clean up - delete the test message
      console.log('🧹 Cleaning up test message...');
      await ChatMessage.destroy({
        where: { id: testMessage.id }
      });
      console.log('✅ Test message deleted\n');
      
      console.log('✅ Database accepts NULL groupId! The schema is correct.');
      console.log('⚠️  If you\'re still getting errors, try:');
      console.log('   1. Restart your backend server');
      console.log('   2. Clear any Sequelize model cache');
      console.log('   3. Check if there are multiple database connections');
      
    } catch (createError) {
      console.error('❌ FAILED to create private message:');
      console.error(`   Error: ${createError.message}`);
      console.error(`   Code: ${createError.code || 'N/A'}`);
      console.error(`   SQL State: ${createError.sqlState || 'N/A'}`);
      
      if (createError.sql) {
        console.error(`   SQL: ${createError.sql}`);
      }
      
      if (createError.parameters) {
        console.error(`   Parameters: ${JSON.stringify(createError.parameters)}`);
      }
      
      console.error('\n❌ The database schema might not be correct, or there\'s a connection issue.');
      process.exit(1);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  }
}

testPrivateMessageInsert();

