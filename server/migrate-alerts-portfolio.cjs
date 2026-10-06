/**
 * Migration: price alerts / portfolio tables, missing indexes, signals.time_ms and
 * legacy plaintext password hashing. Every step is idempotent (safe to run repeatedly)
 * and sends exactly one SQL statement per query (multipleStatements stays disabled).
 *
 * Run: node server/migrate-alerts-portfolio.cjs --yes
 */

const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

if (!process.argv.includes('--yes')) {
    console.error(`Bu script şu veritabanında şema değişikliği yapar: ${process.env.DB_NAME || '(DB_NAME tanımlı değil)'}`);
    console.error('Doğru ortamda olduğunuzdan eminseniz --yes ile çalıştırın: node server/migrate-alerts-portfolio.cjs --yes');
    process.exit(1);
}

// Shares the TLS settings (DB_SSL, DB_SSL_CA, DB_SSL_REJECT_UNAUTHORIZED) with the app.
const pool = require('./db.cjs');

const tableExists = async (conn, table) => {
    const [rows] = await conn.query(
        'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
        [table]
    );
    return rows.length > 0;
};

const indexExists = async (conn, table, indexName) => {
    const [rows] = await conn.query(
        'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
        [table, indexName]
    );
    return rows.length > 0;
};

const columnExists = async (conn, table, column) => {
    const [rows] = await conn.query(
        'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
        [table, column]
    );
    return rows.length > 0;
};

const createIndexStep = (table, indexName, columns) => ({
    name: `Index ${indexName} on ${table}(${columns})`,
    isDone: async (conn) => !(await tableExists(conn, table)) || (await indexExists(conn, table, indexName)),
    run: async (conn) => {
        await conn.query(`CREATE INDEX ${indexName} ON ${table} (${columns})`);
    }
});

// Parses the stored ISO-8601 signal time in JS (timezone-safe); unparseable values become 0.
const backfillSignalTimeMs = async (conn) => {
    let total = 0;
    const attempted = new Set();
    for (;;) {
        const [batch] = await conn.query('SELECT id, time FROM signals WHERE time_ms IS NULL LIMIT 1000');
        const rows = batch.filter(row => !attempted.has(row.id));
        if (batch.length > 0 && rows.length === 0) {
            console.warn('   ↳ Uyarı: bazı satırlar güncellenemedi, geri doldurma durduruldu');
            break;
        }
        if (rows.length === 0) break;
        rows.forEach(row => attempted.add(row.id));
        const cases = [];
        const values = [];
        const ids = [];
        for (const row of rows) {
            const parsed = Date.parse(row.time);
            cases.push('WHEN ? THEN ?');
            values.push(row.id, Number.isFinite(parsed) ? parsed : 0);
            ids.push(row.id);
        }
        const [result] = await conn.query(
            `UPDATE signals SET time_ms = CASE id ${cases.join(' ')} END WHERE id IN (${ids.map(() => '?').join(', ')})`,
            [...values, ...ids]
        );
        if (!result.affectedRows) {
            console.warn('   ↳ Uyarı: satırlar güncellenemedi, geri doldurma durduruldu');
            break;
        }
        total += rows.length;
    }
    console.log(`   ↳ ${total} sinyal satırına time_ms yazıldı`);
};

const hashLegacyPasswords = async (conn) => {
    const [rows] = await conn.query("SELECT id, password FROM users WHERE password IS NOT NULL AND password <> '' AND password NOT LIKE '$2_$%'");
    let count = 0;
    for (const row of rows) {
        const hashed = await bcrypt.hash(String(row.password), 10);
        await conn.query('UPDATE users SET password = ? WHERE id = ? AND password = ?', [hashed, row.id, row.password]);
        count += 1;
    }
    console.log(`   ↳ ${count} kullanıcının düz metin şifresi bcrypt ile hash'lendi`);
};

const migrations = [
    {
        name: 'Create price_alerts table',
        isDone: (conn) => tableExists(conn, 'price_alerts'),
        run: (conn) => conn.query(`
            CREATE TABLE IF NOT EXISTS price_alerts (
                id VARCHAR(100) PRIMARY KEY,
                user_id VARCHAR(100) NOT NULL,
                symbol VARCHAR(50) NOT NULL,
                target_price DECIMAL(20, 8) NOT NULL,
                condition_type ENUM('ABOVE', 'BELOW') NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                created_at BIGINT NOT NULL,
                INDEX idx_user_id (user_id),
                INDEX idx_symbol (symbol),
                INDEX idx_is_active (is_active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `)
    },
    {
        name: 'Create portfolio_holdings table',
        isDone: (conn) => tableExists(conn, 'portfolio_holdings'),
        run: (conn) => conn.query(`
            CREATE TABLE IF NOT EXISTS portfolio_holdings (
                id VARCHAR(100) PRIMARY KEY,
                user_id VARCHAR(100) NOT NULL,
                symbol VARCHAR(50) NOT NULL,
                quantity DECIMAL(20, 8) NOT NULL,
                cost_basis DECIMAL(20, 8) NOT NULL,
                created_at BIGINT DEFAULT 0,
                updated_at BIGINT DEFAULT 0,
                INDEX idx_user_id (user_id),
                INDEX idx_symbol (symbol),
                UNIQUE KEY unique_user_symbol (user_id, symbol)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `)
    },
    {
        name: 'Create trade_history table',
        isDone: (conn) => tableExists(conn, 'trade_history'),
        run: (conn) => conn.query(`
            CREATE TABLE IF NOT EXISTS trade_history (
                id VARCHAR(100) PRIMARY KEY,
                user_id VARCHAR(100) NOT NULL,
                symbol VARCHAR(50) NOT NULL,
                side VARCHAR(10) NOT NULL,
                quantity DECIMAL(20, 8) NOT NULL,
                price DECIMAL(20, 8) NOT NULL,
                timestamp BIGINT NOT NULL,
                INDEX idx_user_id (user_id),
                INDEX idx_symbol (symbol),
                INDEX idx_timestamp (timestamp)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `)
    },
    // username/email already have implicit indexes through their UNIQUE constraints.
    createIndexStep('users', 'idx_users_status', 'status'),
    createIndexStep('signals', 'idx_signals_time', '`time`'),
    {
        name: 'Add numeric signals.time_ms column',
        isDone: async (conn) => !(await tableExists(conn, 'signals')) || (await columnExists(conn, 'signals', 'time_ms')),
        run: (conn) => conn.query('ALTER TABLE signals ADD COLUMN time_ms BIGINT NULL AFTER `time`')
    },
    {
        name: 'Backfill signals.time_ms from signals.time',
        isDone: async (conn) => {
            if (!(await tableExists(conn, 'signals')) || !(await columnExists(conn, 'signals', 'time_ms'))) return true;
            const [rows] = await conn.query('SELECT 1 FROM signals WHERE time_ms IS NULL LIMIT 1');
            return rows.length === 0;
        },
        run: backfillSignalTimeMs
    },
    createIndexStep('signals', 'idx_signals_time_ms', 'time_ms'),
    {
        name: 'Hash legacy plaintext passwords with bcrypt',
        isDone: async (conn) => {
            if (!(await tableExists(conn, 'users'))) return true;
            const [rows] = await conn.query("SELECT 1 FROM users WHERE password IS NOT NULL AND password <> '' AND password NOT LIKE '$2_$%' LIMIT 1");
            return rows.length === 0;
        },
        run: hashLegacyPasswords
    }
];

async function runMigrations() {
    let connection;
    let failed = false;

    try {
        connection = await pool.getConnection();
        console.log(`🔧 Running database migrations on ${process.env.DB_NAME}...\n`);

        for (const migration of migrations) {
            if (await migration.isDone(connection)) {
                console.log(`⏭️  ${migration.name} - zaten uygulanmış`);
                continue;
            }
            try {
                await migration.run(connection);
                console.log(`✅ ${migration.name}`);
            } catch (error) {
                if (error.code === 'ER_DUP_KEYNAME' || error.code === 'ER_DUP_FIELDNAME') {
                    console.log(`⏭️  ${migration.name} - zaten uygulanmış`);
                } else {
                    throw error;
                }
            }
        }

        console.log('\n🎉 All migrations completed successfully!');

        const [tables] = await connection.query(`
            SELECT table_name AS name
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
            AND table_name IN ('price_alerts', 'portfolio_holdings', 'trade_history', 'users', 'signals')
        `);

        console.log('\n📊 Current tables:');
        tables.forEach(t => console.log(`   - ${t.name}`));
    } catch (error) {
        failed = true;
        console.error('\n❌ Migration failed:', error.code || '', error.message);
    } finally {
        if (connection) connection.release();
        await pool.end();
    }

    process.exit(failed ? 1 : 0);
}

runMigrations();
