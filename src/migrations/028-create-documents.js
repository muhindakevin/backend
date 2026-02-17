'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Documents', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      groupId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Groups',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      title: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      fileUrl: {
        type: Sequelize.STRING(500),
        allowNull: false
      },
      fileName: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      fileType: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'e.g., pdf, image, excel, word'
      },
      fileSize: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'File size in bytes'
      },
      category: {
        type: Sequelize.ENUM('contribution', 'loan', 'meeting', 'announcement', 'compliance', 'report', 'other'),
        defaultValue: 'other'
      },
      uploadedBy: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      uploadedByRole: {
        type: Sequelize.ENUM('Secretary', 'Cashier', 'Group Admin', 'System Admin'),
        allowNull: false
      },
      referenceType: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'e.g., Contribution, Loan, Meeting - links to related entity'
      },
      referenceId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'ID of related entity (contribution ID, loan ID, etc.)'
      },
      status: {
        type: Sequelize.ENUM('active', 'archived', 'deleted'),
        defaultValue: 'active'
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('Documents', ['groupId']);
    await queryInterface.addIndex('Documents', ['category']);
    await queryInterface.addIndex('Documents', ['uploadedBy']);
    await queryInterface.addIndex('Documents', ['status']);
    await queryInterface.addIndex('Documents', ['referenceType', 'referenceId']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('Documents');
  }
};

