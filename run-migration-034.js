require('dotenv').config();
const { Sequelize } = require('sequelize');
const fs = require('fs');
const path = require('path');

// Database configuration
const sequelize = new Sequelize(
  process.env.DB_NAME || 'umurenge_wallet',
  process.env.DB_USER || 'root',
  process.env.DB_PASS || '',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: console.log
  }
);

async function runMigration() {
  try {
    await sequelize.authenticate();
    console.log('Database connected successfully.');

    // Read migration file
    const migrationPath = path.join(__dirname, 'src', 'migrations', '034-add-attendance-taken-columns-to-meetings.js');
    const migration = require(migrationPath);

    console.log('Running migration: 034-add-attendance-taken-columns-to-meetings');
    await migration.up(sequelize.getQueryInterface(), Sequelize);
    console.log('Migration completed successfully!');

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error);
    await sequelize.close();
    process.exit(1);
  }
}

runMigration();

