require('dotenv').config();
const { sequelize } = require('./src/models');

async function recordMigration() {
  try {
    await sequelize.query(`
      INSERT INTO SequelizeMeta (name) 
      SELECT '021-add-receiverId-to-chat-messages.js' 
      WHERE NOT EXISTS (
        SELECT 1 FROM SequelizeMeta WHERE name = '021-add-receiverId-to-chat-messages.js'
      )
    `);
    console.log('✅ Migration recorded in SequelizeMeta');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

recordMigration();

