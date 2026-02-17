const { sequelize } = require('./src/models');

// Override the query method to prevent actual execution and just log the SQL
// This mock allows us to capture the "sync" SQL commands without a real database connection
const originalQuery = sequelize.query;

// We need to capture the SQL that WOULD be executed
// Sequelize calls log() function with the SQL
sequelize.options.logging = (msg) => {
    // Clean up the log message to prompt clean SQL
    let sql = msg;
    if (sql.startsWith('Executing (default): ')) {
        sql = sql.replace('Executing (default): ', '');
    }
    // Remove terminal colors if any (unlikely in simple string, but valid precaution)
    // Ensure it ends with semicolon
    if (!sql.trim().endsWith(';')) {
        sql += ';';
    }
    console.log(sql);
};

// Mock authenticate to pass checks
sequelize.authenticate = async () => Promise.resolve();

// Mock query to return success immediately
sequelize.query = async (sql, options) => {
    // We rely on the logging option to output the SQL
    // Return a dummy promise resolution that satisfies Sequelize's expectation
    // usually [results, metadata]
    return Promise.resolve([[], 0]);
};

// Mock getQueryInterface methods that might check DB version etc
sequelize.getQueryInterface().showAllSchemas = async () => [];
sequelize.getQueryInterface().showAllTables = async () => [];

console.log('-- Generated SQL Schema from Sequelize Models');
console.log(`-- Date: ${new Date().toISOString()}`);
console.log('SET FOREIGN_KEY_CHECKS = 0;');
console.log('');

// Parse the models and generate the SQL
// We use force: true to generate DROP TABLE statements first
sequelize.sync({ force: true, match: /./ })
    .then(() => {
        console.log('');
        console.log('SET FOREIGN_KEY_CHECKS = 1;');
        process.exit(0);
    })
    .catch(err => {
        console.error('/* Error generating schema:', err.message, '*/');
        process.exit(1);
    });
