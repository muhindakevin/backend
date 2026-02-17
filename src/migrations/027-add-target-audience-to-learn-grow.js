'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('LearnGrowContents', 'targetAudience', {
      type: Sequelize.ENUM('members', 'secretary', 'both'),
      defaultValue: 'members',
      allowNull: false,
      comment: 'Target audience for the course: members, secretary, or both'
    });

    await queryInterface.addIndex('LearnGrowContents', ['targetAudience']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('LearnGrowContents', ['targetAudience']);
    await queryInterface.removeColumn('LearnGrowContents', 'targetAudience');
  }
};

