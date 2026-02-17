'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Loans', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      memberId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
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
      amount: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false
      },
      purpose: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      interestRate: {
        type: Sequelize.DECIMAL(5, 2),
        defaultValue: 5.0
      },
      duration: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      monthlyPayment: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false
      },
      totalAmount: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('pending', 'approved', 'rejected', 'disbursed', 'active', 'completed', 'defaulted'),
        defaultValue: 'pending'
      },
      requestDate: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      approvalDate: {
        type: Sequelize.DATE,
        allowNull: true
      },
      approvedBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      disbursementDate: {
        type: Sequelize.DATE,
        allowNull: true
      },
      paidAmount: {
        type: Sequelize.DECIMAL(15, 2),
        defaultValue: 0
      },
      remainingAmount: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false
      },
      nextPaymentDate: {
        type: Sequelize.DATE,
        allowNull: true
      },
      aiRecommendation: {
        type: Sequelize.ENUM('approve', 'reject', 'review'),
        allowNull: true
      },
      rejectionReason: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      documents: {
        type: Sequelize.JSON,
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

    await queryInterface.addIndex('Loans', ['memberId']);
    await queryInterface.addIndex('Loans', ['groupId']);
    await queryInterface.addIndex('Loans', ['status']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Loans');
  }
};

