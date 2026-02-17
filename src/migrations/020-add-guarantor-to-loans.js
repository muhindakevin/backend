'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Loans', 'guarantorId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'Users',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      comment: 'Reference to the guarantor user (must be a member of the same group)'
    });

    await queryInterface.addColumn('Loans', 'guarantorName', {
      type: Sequelize.STRING(100),
      allowNull: true,
      comment: 'Guarantor full name'
    });

    await queryInterface.addColumn('Loans', 'guarantorPhone', {
      type: Sequelize.STRING(20),
      allowNull: true,
      comment: 'Guarantor phone number'
    });

    await queryInterface.addColumn('Loans', 'guarantorNationalId', {
      type: Sequelize.STRING(50),
      allowNull: true,
      comment: 'Guarantor national ID'
    });

    await queryInterface.addColumn('Loans', 'guarantorRelationship', {
      type: Sequelize.STRING(100),
      allowNull: true,
      comment: 'Relationship to borrower (e.g., family member, friend, colleague)'
    });

    await queryInterface.addIndex('Loans', ['guarantorId']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('Loans', ['guarantorId']);
    await queryInterface.removeColumn('Loans', 'guarantorId');
    await queryInterface.removeColumn('Loans', 'guarantorName');
    await queryInterface.removeColumn('Loans', 'guarantorPhone');
    await queryInterface.removeColumn('Loans', 'guarantorNationalId');
    await queryInterface.removeColumn('Loans', 'guarantorRelationship');
  }
};

