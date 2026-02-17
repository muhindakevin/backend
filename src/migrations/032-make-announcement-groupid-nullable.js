'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Make groupId nullable to allow system-wide announcements
    await queryInterface.changeColumn('Announcements', 'groupId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'Groups',
        key: 'id'
      }
    });
  },

  async down(queryInterface, Sequelize) {
    // Revert: make groupId not nullable again
    // First, we need to set groupId for any null announcements
    await queryInterface.sequelize.query(`
      UPDATE Announcements 
      SET groupId = (SELECT id FROM Groups LIMIT 1)
      WHERE groupId IS NULL
    `);
    
    await queryInterface.changeColumn('Announcements', 'groupId', {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: {
        model: 'Groups',
        key: 'id'
      }
    });
  }
};

