'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Users', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      email: {
        type: Sequelize.STRING,
        allowNull: true,
        unique: true
      },
      phone: {
        type: Sequelize.STRING(20),
        allowNull: false,
        unique: true
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      password: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      role: {
        type: Sequelize.ENUM('Member', 'Group Admin', 'Cashier', 'Secretary', 'Agent', 'System Admin'),
        allowNull: false,
        defaultValue: 'Member'
      },
      groupId: {
        type: Sequelize.INTEGER,
        allowNull: true
        // Foreign key will be added in migration 017 after Groups table exists
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
      status: {
        type: Sequelize.ENUM('active', 'inactive', 'suspended', 'pending'),
        defaultValue: 'active'
      },
      totalSavings: {
        type: Sequelize.DECIMAL(15, 2),
        defaultValue: 0
      },
      creditScore: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      otp: {
        type: Sequelize.STRING(6),
        allowNull: true
      },
      otpExpiry: {
        type: Sequelize.DATE,
        allowNull: true
      },
      language: {
        type: Sequelize.STRING(10),
        defaultValue: 'en'
      },
      profileImage: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      occupation: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      address: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      dateOfBirth: {
        type: Sequelize.DATE,
        allowNull: true
      },
      nationalId: {
        type: Sequelize.STRING(50),
        allowNull: true,
        unique: true
      },
      lastLogin: {
        type: Sequelize.DATE,
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
    await queryInterface.dropTable('Users');
  }
};

