'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Groups', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true
      },
      code: {
        type: Sequelize.STRING(20),
        allowNull: false,
        unique: true
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      branchId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Branches',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      agentId: {
        type: Sequelize.INTEGER,
        allowNull: true
        // Foreign key will be added in migration 017 after Users table exists
      },
      totalSavings: {
        type: Sequelize.DECIMAL(15, 2),
        defaultValue: 0
      },
      totalMembers: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      contributionAmount: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: true
      },
      contributionFrequency: {
        type: Sequelize.ENUM('daily', 'weekly', 'monthly'),
        defaultValue: 'monthly'
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive', 'suspended'),
        defaultValue: 'active'
      },
      registrationDate: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      district: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      sector: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      cell: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Groups');
  }
};

