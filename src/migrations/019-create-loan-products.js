'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('LoanProducts', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      name: { type: Sequelize.STRING(100), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      interestRate: { type: Sequelize.DECIMAL(5,2), allowNull: false, defaultValue: 0 },
      maxAmount: { type: Sequelize.DECIMAL(15,2), allowNull: false, defaultValue: 0 },
      minAmount: { type: Sequelize.DECIMAL(15,2), allowNull: false, defaultValue: 0 },
      termMonths: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('LoanProducts');
  }
};


