/**
 * One-off import of server/users_db.json into MySQL. Passwords are always stored as bcrypt hashes.
 * Run: node server/import_users.cjs --yes
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

if (!process.argv.includes('--yes')) {
    console.error(`Bu script şu veritabanına kullanıcı ekler: ${process.env.DB_NAME || '(DB_NAME tanımlı değil)'}`);
    console.error('Doğru ortamda olduğunuzdan eminseniz --yes ile çalıştırın: node server/import_users.cjs --yes');
    process.exit(1);
}

const db = require('./db.cjs');

const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$/;

const importUsers = async () => {
    let connection;
    try {
        const usersFile = path.join(__dirname, 'users_db.json');

        if (!fs.existsSync(usersFile)) {
            console.log('No local users file found.');
            await db.end();
            process.exit(0);
        }

        const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
        console.log(`Found ${users.length} users to import.`);

        connection = await db.getConnection();

        for (const user of users) {
            // Handle users without username/password (first one in json seems to lack them)
            if (!user.username || !user.password) {
                console.log(`Skipping invalid user record (missing username/password): ${user.email}`);
                continue;
            }

            // Check if user exists
            const [rows] = await connection.query('SELECT id FROM users WHERE username = ? OR email = ?', [user.username, user.email]);

            if (rows.length > 0) {
                console.log(`User ${user.username} already exists, skipping.`);
                continue;
            }

            // Never store plaintext: hash unless the value is already a bcrypt hash.
            const password = String(user.password);
            const passwordHash = BCRYPT_HASH_RE.test(password) ? password : await bcrypt.hash(password, 10);

            const query = `
                INSERT INTO users (id, email, name, username, password, role, status, created_at, updated_at, permissions, last_login)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            await connection.query(query, [
                user.id,
                user.email,
                user.name,
                user.username,
                passwordHash,
                user.role,
                user.status,
                user.createdAt,
                user.updatedAt,
                JSON.stringify(user.permissions || []),
                user.lastLogin || null
            ]);

            console.log(`✅ Imported user: ${user.username}`);
        }

        connection.release();
        await db.end();
        console.log('🎉 Import completed.');
        process.exit(0);

    } catch (error) {
        console.error('❌ Import failed:', error.code || '', error.message);
        if (connection) connection.release();
        process.exit(1);
    }
};

importUsers();
