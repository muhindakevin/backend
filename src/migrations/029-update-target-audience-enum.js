'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // For MySQL/MariaDB, we need to alter the ENUM type
    // First, check if we're using MySQL
    const [results] = await queryInterface.sequelize.query("SELECT VERSION() as version");
    const isMySQL = results && results[0] && results[0].version;
    
    if (isMySQL) {
      // MySQL: Alter the ENUM column
      await queryInterface.sequelize.query(`
        ALTER TABLE LearnGrowContents 
        MODIFY COLUMN targetAudience ENUM('members', 'secretary', 'agent', 'both') 
        DEFAULT 'members' NOT NULL
      `);
    } else {
      // For PostgreSQL or other databases, use a different approach
      // Drop the old enum and create a new one
      try {
        await queryInterface.sequelize.query(`
          ALTER TABLE "LearnGrowContents" 
          DROP CONSTRAINT IF EXISTS "LearnGrowContents_targetAudience_check"
        `);
        
        await queryInterface.sequelize.query(`
          ALTER TABLE "LearnGrowContents" 
          ADD CONSTRAINT "LearnGrowContents_targetAudience_check" 
          CHECK (targetAudience IN ('members', 'secretary', 'agent', 'both'))
        `);
      } catch (error) {
        // If constraint doesn't exist or other error, try column modification
        console.log('Note: Could not modify enum constraint, may need manual update');
      }
    }
  },

  down: async (queryInterface, Sequelize) => {
    // Revert to original enum (without 'agent')
    const [results] = await queryInterface.sequelize.query("SELECT VERSION() as version");
    const isMySQL = results && results[0] && results[0].version;
    
    if (isMySQL) {
      await queryInterface.sequelize.query(`
        ALTER TABLE LearnGrowContents 
        MODIFY COLUMN targetAudience ENUM('members', 'secretary', 'both') 
        DEFAULT 'members' NOT NULL
      `);
    } else {
      try {
        await queryInterface.sequelize.query(`
          ALTER TABLE "LearnGrowContents" 
          DROP CONSTRAINT IF EXISTS "LearnGrowContents_targetAudience_check"
        `);
        
        await queryInterface.sequelize.query(`
          ALTER TABLE "LearnGrowContents" 
          ADD CONSTRAINT "LearnGrowContents_targetAudience_check" 
          CHECK (targetAudience IN ('members', 'secretary', 'both'))
        `);
      } catch (error) {
        console.log('Note: Could not revert enum constraint');
      }
    }
  }
};

