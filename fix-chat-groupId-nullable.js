/**
 * Script to fix ChatMessages table to allow NULL groupId for private messages
 * This makes groupId nullable so private messages can be stored
 * Run this with: node fix-chat-groupId-nullable.js
 */

require('dotenv').config();
const { sequelize } = require('./src/models');

async function fixGroupIdNullable() {
  try {
    console.log('🔄 Fixing ChatMessages table to allow NULL groupId...');
    
    const queryInterface = sequelize.getQueryInterface();
    
    // Check if receiverId column exists
    const tableDescription = await queryInterface.describeTable('ChatMessages');
    
    if (!tableDescription.receiverId) {
      console.log('📝 Adding receiverId column...');
      await queryInterface.addColumn('ChatMessages', 'receiverId', {
        type: sequelize.Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Receiver user ID for private messages (null for group messages)'
      });
      console.log('✅ receiverId column added');
    } else {
      console.log('✅ receiverId column already exists');
    }
    
    // Make groupId nullable
    console.log('📝 Making groupId nullable...');
    await queryInterface.changeColumn('ChatMessages', 'groupId', {
      type: sequelize.Sequelize.INTEGER,
      allowNull: true, // Changed from false to true
      references: {
        model: 'Groups',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    });
    console.log('✅ groupId is now nullable');
    
    // Add indexes if they don't exist
    try {
      const indexes = await sequelize.queryInterface.showIndex('ChatMessages');
      const indexNames = indexes.map(idx => idx.name || idx.Key_name);
      
      if (!indexNames.some(name => name.includes('receiverId'))) {
        console.log('📝 Adding indexes...');
        await queryInterface.addIndex('ChatMessages', ['receiverId']);
        await queryInterface.addIndex('ChatMessages', ['senderId', 'receiverId', 'createdAt']);
        console.log('✅ Indexes added');
      } else {
        console.log('✅ Indexes already exist');
      }
    } catch (indexError) {
      console.log('⚠️  Could not check/add indexes (may already exist):', indexError.message);
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

fixGroupIdNullable();

