'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // For MySQL/MariaDB, we need to alter the enum type
    // First, let's check what database we're using and handle accordingly
    
    try {
      // Get the current enum values
      const [results] = await queryInterface.sequelize.query(`
        SELECT COLUMN_TYPE 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'Votes' 
        AND COLUMN_NAME = 'type'
      `);
      
      if (results && results.length > 0) {
        // For MySQL/MariaDB, we need to modify the column
        await queryInterface.sequelize.query(`
          ALTER TABLE Votes 
          MODIFY COLUMN type ENUM(
            'loan_approval',
            'loan_approval_override',
            'member_admission',
            'fine_waiver',
            'policy_change',
            'withdrawal_approval',
            'contribution_change',
            'saving_amount_change',
            'fine_change',
            'fine_amount_change',
            'interest_rate_change',
            'other'
          ) NOT NULL
        `);
      }
    } catch (error) {
      // If the above fails, try PostgreSQL syntax
      try {
        await queryInterface.sequelize.query(`
          ALTER TABLE "Votes" 
          DROP CONSTRAINT IF EXISTS "Votes_type_check";
        `);
        
        await queryInterface.sequelize.query(`
          ALTER TABLE "Votes" 
          ADD CONSTRAINT "Votes_type_check" 
          CHECK (type IN (
            'loan_approval',
            'loan_approval_override',
            'member_admission',
            'fine_waiver',
            'policy_change',
            'withdrawal_approval',
            'contribution_change',
            'saving_amount_change',
            'fine_change',
            'fine_amount_change',
            'interest_rate_change',
            'other'
          ));
        `);
      } catch (pgError) {
        // If both fail, log the error but don't throw
        console.error('Failed to update vote type enum:', error.message);
        console.error('PostgreSQL attempt also failed:', pgError.message);
        // For SQLite, enums are stored as strings, so no migration needed
        console.log('Note: If using SQLite, enum values are stored as strings and no migration is needed.');
      }
    }
  },

  async down(queryInterface, Sequelize) {
    // Revert to original enum values
    try {
      await queryInterface.sequelize.query(`
        ALTER TABLE Votes 
        MODIFY COLUMN type ENUM(
          'loan_approval',
          'member_admission',
          'fine_waiver',
          'policy_change',
          'other'
        ) NOT NULL
      `);
    } catch (error) {
      console.error('Failed to revert vote type enum:', error.message);
    }
  }
};

