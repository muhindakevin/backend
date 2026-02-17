'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Check if column exists
    const [results] = await queryInterface.sequelize.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'LearnGrowContents' 
      AND COLUMN_NAME = 'targetAudience'
    `);

    if (results.length === 0) {
      // Column doesn't exist, add it
      console.log('Adding targetAudience column to LearnGrowContents...');
      await queryInterface.addColumn('LearnGrowContents', 'targetAudience', {
        type: Sequelize.ENUM('members', 'secretary', 'agent', 'agents', 'both'),
        defaultValue: 'members',
        allowNull: false,
        comment: 'Target audience for the course: members, secretary, agent, agents, or both'
      });

      await queryInterface.addIndex('LearnGrowContents', ['targetAudience']);
    } else {
      // Column exists, update the ENUM to include all values
      console.log('Updating targetAudience ENUM to include all values...');
      try {
        await queryInterface.sequelize.query(`
          ALTER TABLE LearnGrowContents 
          MODIFY COLUMN targetAudience ENUM('members', 'secretary', 'agent', 'agents', 'both') 
          DEFAULT 'members' NOT NULL
        `);
      } catch (error) {
        console.log('Note: Could not modify ENUM, column may already have correct values:', error.message);
      }
    }
  },

  down: async (queryInterface, Sequelize) => {
    // Only remove if we added it (check first)
    const [results] = await queryInterface.sequelize.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'LearnGrowContents' 
      AND COLUMN_NAME = 'targetAudience'
    `);

    if (results.length > 0) {
      await queryInterface.removeIndex('LearnGrowContents', ['targetAudience']);
      await queryInterface.removeColumn('LearnGrowContents', 'targetAudience');
    }
  }
};

