'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add attendanceTakenBy column
    await queryInterface.addColumn('Meetings', 'attendanceTakenBy', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'Users',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      comment: 'User ID who took the attendance'
    });

    // Add attendanceTakenAt column
    await queryInterface.addColumn('Meetings', 'attendanceTakenAt', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Date and time when attendance was taken'
    });

    // Add index for attendanceTakenBy
    await queryInterface.addIndex('Meetings', ['attendanceTakenBy']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('Meetings', ['attendanceTakenBy']);
    await queryInterface.removeColumn('Meetings', 'attendanceTakenAt');
    await queryInterface.removeColumn('Meetings', 'attendanceTakenBy');
  }
};

