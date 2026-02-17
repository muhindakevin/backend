require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const config = {
    host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : (process.env.DB_HOST || '127.0.0.1'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'umurenge_wallet',
    port: process.env.DB_PORT || 3306
};

async function dumpSchema() {
    let connection;
    try {
        console.log(`Connecting to database ${config.database} at ${config.host}:${config.port} as ${config.user}...`);
        connection = await mysql.createConnection(config);
        console.log('Connection established.');

        // Get all tables
        const [tables] = await connection.query('SHOW FULL TABLES WHERE Table_type = "BASE TABLE"');

        if (tables.length === 0) {
            console.log('No tables found in the database.');
            return;
        }

        let sqlDump = `-- Database Schema Dump\n-- Generated on ${new Date().toISOString()}\n-- Database: ${config.database}\n\n`;
        sqlDump += `SET FOREIGN_KEY_CHECKS = 0;\n\n`;

        for (const row of tables) {
            const tableName = Object.values(row)[0];
            console.log(`Exporting table: ${tableName}`);

            const [createTableResult] = await connection.query(`SHOW CREATE TABLE \`${tableName}\``);
            const createTableSql = createTableResult[0]['Create Table'];

            sqlDump += `-- Table structure for table \`${tableName}\`\n`;
            sqlDump += `DROP TABLE IF EXISTS \`${tableName}\`;\n`;
            sqlDump += `${createTableSql};\n\n`;
        }

        sqlDump += `SET FOREIGN_KEY_CHECKS = 1;\n`;

        const outputPath = path.join(__dirname, 'schema.sql');
        fs.writeFileSync(outputPath, sqlDump);
        console.log(`\nSchema successfully exported to: ${outputPath}`);

    } catch (error) {
        console.error('FAILED_TO_DUMP:', error.message);
        if (error.code) console.error('Error Code:', error.code);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

dumpSchema();
