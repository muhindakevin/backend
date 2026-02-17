'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add receiverId column for private messages
    await queryInterface.addColumn('ChatMessages', 'receiverId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'Users',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      comment: 'Receiver user ID for private messages (null for group messages)'
    });

    // Make groupId nullable (for private messages)
    await queryInterface.changeColumn('ChatMessages', 'groupId', {
      type: Sequelize.INTEGER,
      allowNull: true, // Changed from false to true
      references: {
        model: 'Groups',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    });

    // Add index for receiverId for better query performance
    await queryInterface.addIndex('ChatMessages', ['receiverId']);
    
    // Add composite index for private chat queries
    await queryInterface.addIndex('ChatMessages', ['senderId', 'receiverId', 'createdAt']);
  },

  async down(queryInterface, Sequelize) {
    // Remove indexes
    await queryInterface.removeIndex('ChatMessages', ['receiverId']);
    await queryInterface.removeIndex('ChatMessages', ['senderId', 'receiverId', 'createdAt']);
    
    // Remove receiverId column
    await queryInterface.removeColumn('ChatMessages', 'receiverId');
    
    // Revert groupId to NOT NULL (if needed)
    await queryInterface.changeColumn('ChatMessages', 'groupId', {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: {
        model: 'Groups',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    });
  }
};

