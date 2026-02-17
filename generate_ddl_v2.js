const fs = require('fs');
const { sequelize } = require('./src/models');

const outputFile = 'schema_final.sql';

// Override query to capture SQL
const capturedSql = [];
sequelize.query = async (sql) => {
    let cleanSql = sql.replace('Executing (default): ', '').trim();
    if (!cleanSql.endsWith(';')) cleanSql += ';';
    capturedSql.push(cleanSql);
    return Promise.resolve([[], 0]);
};
sequelize.authenticate = async () => { };

async function generate() {
    const models = sequelize.modelManager.models;

    capturedSql.push('-- Schema Dump');
    capturedSql.push(`-- Generated: ${new Date().toISOString()}`);
    capturedSql.push('SET FOREIGN_KEY_CHECKS = 0;');
    capturedSql.push('');

    // 1. Drop all tables
    for (const model of models) {
        if (model.name === 'SequelizeMeta') continue;
        capturedSql.push(`DROP TABLE IF EXISTS \`${model.tableName}\`;`);
    }
    capturedSql.push('');

    // 2. Create all tables
    // We accept that there might be circular references, so we rely on FK checks being off
    for (const model of models) {
        if (model.name === 'SequelizeMeta') continue;

        console.log(`Generating schema for ${model.name}...`);
        try {
            // Use rawAttributes which includes injected FKs
            // QueryInterface.createTable expects (tableName, attributes, options)
            await sequelize.getQueryInterface().createTable(model.tableName, model.tableAttributes);
            capturedSql.push('');
        } catch (e) {
            console.error(`Error creating ${model.name}:`, e.message);
            capturedSql.push(`-- Error creating ${model.name}: ${e.message}`);
        }
    }

    capturedSql.push('SET FOREIGN_KEY_CHECKS = 1;');

    fs.writeFileSync(outputFile, capturedSql.join('\n'));
    console.log(`Schema written to ${outputFile}`);
}

generate().then(() => {
    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
