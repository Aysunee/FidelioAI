/**
 * Creates all tables from schema.sql (idempotent: CREATE TABLE IF NOT EXISTS).
 * Run: node server/migrate.cjs --yes
 * Then for existing databases: node server/migrate-alerts-portfolio.cjs --yes
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

if (!process.argv.includes('--yes')) {
    console.error(`Bu script şu veritabanında şema oluşturur: ${process.env.DB_NAME || '(DB_NAME tanımlı değil)'}`);
    console.error('Doğru ortamda olduğunuzdan eminseniz --yes ile çalıştırın: node server/migrate.cjs --yes');
    process.exit(1);
}

const db = require('./db.cjs');

const runMigration = async () => {
    let connection;
    try {
        console.log(`🎯 Hedef veritabanı: ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
        const schemaPath = path.join(__dirname, 'schema.sql');
        const sql = fs.readFileSync(schemaPath, 'utf8');

        // Split by semicolon to handle multiple statements
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        console.log(`Found ${statements.length} SQL statements to execute.`);

        connection = await db.getConnection();

        for (const statement of statements) {
            await connection.query(statement);
            console.log('✅ Executed statement');
        }

        console.log('🎉 Migration completed successfully. Tables are ready.');
        connection.release();
        await db.end();
        process.exit(0);

    } catch (error) {
        console.error('❌ Migration failed:', error.code || '', error.message);
        if (connection) connection.release();
        process.exit(1);
    }
};

runMigration();
