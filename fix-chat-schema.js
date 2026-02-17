/**
 * Quick fix script to make groupId nullable in ChatMessages table
 */

require('dotenv').config();
const { sequelize } = require('./src/models');

async function fixSchema() {
  try {
    console.log('🔄 Making groupId nullable in ChatMessages table...');
    
    const queryInterface = sequelize.getQueryInterface();
    
    // Check if receiverId exists, if not add it
    const [results] = await sequelize.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'ChatMessages' 
      AND COLUMN_NAME = 'receiverId'
    `);
    
    if (results.length === 0) {
      console.log('Adding receiverId column...');
      await queryInterface.addColumn('ChatMessages', 'receiverId', {
        type: sequelize.Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      });
    } else {
      console.log('receiverId column already exists');
    }
    
    // Make groupId nullable
    console.log('Making groupId nullable...');
    await queryInterface.changeColumn('ChatMessages', 'groupId', {
      type: sequelize.Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'Groups',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    });
    
    console.log('✅ Schema fixed successfully!');
    console.log('✅ groupId is now nullable');
    console.log('✅ receiverId column exists');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  }
}

fixSchema();

