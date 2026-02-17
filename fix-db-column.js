const { Sequelize } = require('sequelize');
const db = require('./config/db');

async function fixUserStatusEnum() {
    try {
        console.log('Starting manual database fix for user status enum...');

        // We'll use a raw query to alter the ENUM in MySQL
        await db.sequelize.query(`
      ALTER TABLE Users 
      MODIFY COLUMN status ENUM('active', 'inactive', 'suspended', 'pending', 'burned') 
      DEFAULT 'active'
    `);

        console.log('✅ Successfully updated status enum in Users table to include "burned".');
        process.exit(0);
    } catch (error) {
        console.error('❌ Failed to update status enum:', error);
        process.exit(1);
    }
}

fixUserStatusEnum();
