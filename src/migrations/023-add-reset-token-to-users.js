'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Check if resetToken column already exists
    const [resetTokenExists] = await queryInterface.sequelize.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'Users' 
      AND COLUMN_NAME = 'resetToken'
    `);

    // Check if resetTokenExpiry column already exists
    const [resetTokenExpiryExists] = await queryInterface.sequelize.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'Users' 
      AND COLUMN_NAME = 'resetTokenExpiry'
    `);

    // Add resetToken column if it doesn't exist
    if (!resetTokenExists || resetTokenExists.length === 0) {
      await queryInterface.addColumn('Users', 'resetToken', {
        type: Sequelize.STRING(255),
        allowNull: true,
        comment: 'Password reset token'
      });
      console.log('✅ Added resetToken column to Users table');
    } else {
      console.log('ℹ️  resetToken column already exists, skipping...');
    }

    // Add resetTokenExpiry column if it doesn't exist
    if (!resetTokenExpiryExists || resetTokenExpiryExists.length === 0) {
      await queryInterface.addColumn('Users', 'resetTokenExpiry', {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Password reset token expiration date'
      });
      console.log('✅ Added resetTokenExpiry column to Users table');
    } else {
      console.log('ℹ️  resetTokenExpiry column already exists, skipping...');
    }

    // Check if index exists before adding
    // Check for a single-column index specifically on resetToken (not composite indexes)
    const [indexes] = await queryInterface.sequelize.query(`
      SELECT INDEX_NAME, SEQ_IN_INDEX, NON_UNIQUE
      FROM INFORMATION_SCHEMA.STATISTICS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'Users' 
      AND COLUMN_NAME = 'resetToken'
      ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `);

    // Check if there's a single-column index (SEQ_IN_INDEX = 1 and only one row per INDEX_NAME)
    let indexExists = false;
    if (indexes && indexes.length > 0) {
      // Group by INDEX_NAME to check if any index is single-column
      const indexGroups = {};
      indexes.forEach(idx => {
        if (!indexGroups[idx.INDEX_NAME]) {
          indexGroups[idx.INDEX_NAME] = [];
        }
        indexGroups[idx.INDEX_NAME].push(idx);
      });
      
      // Check if any index has only resetToken (single column index)
      for (const indexName in indexGroups) {
        const indexCols = indexGroups[indexName];
        if (indexCols.length === 1 && indexCols[0].SEQ_IN_INDEX === 1) {
          indexExists = true;
          break;
        }
      }
    }

    // Check total number of indexes on Users table
    const [totalIndexes] = await queryInterface.sequelize.query(`
      SELECT COUNT(DISTINCT INDEX_NAME) as index_count
      FROM INFORMATION_SCHEMA.STATISTICS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'Users'
      AND INDEX_NAME != 'PRIMARY'
    `);

    const totalIndexCount = totalIndexes && totalIndexes[0] ? totalIndexes[0].index_count : 0;

    // Add index for faster lookups if it doesn't exist and we're under the limit
    if (!indexExists) {
      if (totalIndexCount >= 64) {
        console.log('⚠️  Cannot add index on resetToken: table already has 64 indexes (MySQL limit). Index is optional for functionality.');
        console.log('ℹ️  The resetToken column will work without an index, but queries may be slower.');
      } else {
        try {
          await queryInterface.addIndex('Users', ['resetToken']);
          console.log('✅ Added index on resetToken column');
        } catch (error) {
          if (error.message && error.message.includes('Too many keys')) {
            console.log('⚠️  Cannot add index on resetToken: MySQL index limit reached. Index is optional for functionality.');
          } else {
            throw error;
          }
        }
      }
    } else {
      console.log('ℹ️  Index on resetToken already exists, skipping...');
    }
  },

  async down(queryInterface, Sequelize) {
    // Check if index exists before removing
    const [indexes] = await queryInterface.sequelize.query(`
      SELECT INDEX_NAME 
      FROM INFORMATION_SCHEMA.STATISTICS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'Users' 
      AND COLUMN_NAME = 'resetToken'
    `);

    if (indexes && indexes.length > 0) {
      await queryInterface.removeIndex('Users', ['resetToken']);
    }

    // Check if columns exist before removing
    const [resetTokenExists] = await queryInterface.sequelize.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'Users' 
      AND COLUMN_NAME = 'resetToken'
    `);

    const [resetTokenExpiryExists] = await queryInterface.sequelize.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'Users' 
      AND COLUMN_NAME = 'resetTokenExpiry'
    `);

    if (resetTokenExists && resetTokenExists.length > 0) {
      await queryInterface.removeColumn('Users', 'resetToken');
    }

    if (resetTokenExpiryExists && resetTokenExpiryExists.length > 0) {
      await queryInterface.removeColumn('Users', 'resetTokenExpiry');
    }
  }
};

