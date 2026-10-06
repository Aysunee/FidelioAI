const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
// Load the project-root .env regardless of the process cwd (Hostinger may start the app from server/).
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

// ===== TLS configuration =====
// DB_SSL=false                      -> no TLS (only for a local development MySQL)
// DB_SSL_CA=/path/to/ca.pem         -> verify the server certificate against this CA
// DB_SSL_REJECT_UNAUTHORIZED=true   -> verify the server certificate (system CAs or DB_SSL_CA)
// Default stays "TLS without certificate verification" so the existing Hostinger connection keeps working.
// Once DB_SSL_CA is set, verification stays ON (fail-closed, even if the file cannot be read) unless
// DB_SSL_REJECT_UNAUTHORIZED=false is given explicitly.
const buildSslConfig = () => {
    if (String(process.env.DB_SSL || '').toLowerCase() === 'false') {
        console.warn('⚠️  DB_SSL=false: MySQL bağlantısı şifrelenmeden kuruluyor. Yalnızca yerel geliştirme veritabanında kullanın.');
        return undefined;
    }

    const ssl = {};
    const rejectEnv = String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase();
    const caRequested = !!process.env.DB_SSL_CA;
    if (caRequested) {
        try {
            ssl.ca = fs.readFileSync(path.resolve(process.env.DB_SSL_CA), 'utf8');
        } catch (err) {
            console.error(`❌ DB_SSL_CA dosyası okunamadı (${process.env.DB_SSL_CA}):`, err.code || err.message,
                rejectEnv === 'false'
                    ? ''
                    : '- Sertifika doğrulaması AÇIK kalıyor (sistem CA\'ları ile); dosya yolunu/izinlerini düzeltin.');
        }
    }

    // Explicit env wins; otherwise verify whenever a CA bundle was configured (even if it could not be read).
    const rejectUnauthorized = rejectEnv === 'true' || (rejectEnv !== 'false' && caRequested);
    ssl.rejectUnauthorized = rejectUnauthorized;

    if (!rejectUnauthorized) {
        console.warn('⚠️  MySQL TLS sertifika doğrulaması KAPALI (DB_SSL_REJECT_UNAUTHORIZED). Ortadaki adam saldırılarına açıktır; sağlayıcının CA sertifikasını DB_SSL_CA ile verip DB_SSL_REJECT_UNAUTHORIZED=true yapın.');
    }
    return ssl;
};

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // Never expand JS objects into `col` = value SQL fragments (defence against type-confused input).
    stringifyObjects: true,
    ssl: buildSslConfig()
});

// Test connection
pool.getConnection()
    .then(connection => {
        console.log('✅ Connected to MySQL Database');
        connection.release();
    })
    .catch(err => {
        console.error('❌ Database connection failed:', err.code || err.message);
    });

module.exports = pool;
