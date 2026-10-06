const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
// Load the project-root .env regardless of the process cwd (Hostinger may start the app from server/).
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const db = require('./db.cjs');

const app = express();
const server = http.createServer(app);

// ===== CONSTANTS =====
const USER_ROLES = ['admin', 'trader', 'viewer', 'analyst'];
const USER_STATUSES = ['active', 'inactive'];
const PERMISSIONS = ['view_dashboard', 'manage_trades', 'manage_users', 'view_analytics', 'manage_settings'];
const SIGNAL_SIDES = ['BUY', 'SELL', 'LONG', 'SHORT'];
const SIGNAL_SOURCES = ['WEBHOOK', 'ALGO_MOMENTUM', 'ALGO_DIVERGENCE', 'ALGO_VOLUME', 'MANUAL'];
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 72; // bcrypt silently ignores everything after 72 bytes
const SIGNAL_DEDUP_WINDOW_MS = 60 * 1000;
const SIGNALS_DEFAULT_LIMIT = 100;
const SIGNALS_MAX_LIMIT = 500;
const MAX_PRICE = 1e12; // DECIMAL(20, 8)
const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$/;

// ===== JWT CONFIGURATION =====
const resolveJwtSecret = () => {
    const fromEnv = process.env.JWT_SECRET;
    if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
        if (fromEnv.length < 32) {
            console.warn('⚠️  JWT_SECRET 32 karakterden kısa. `openssl rand -base64 48` ile daha güçlü bir değer üretin.');
        }
        return fromEnv;
    }
    const line = '!'.repeat(78);
    console.warn(`\n${line}\n⚠️  JWT_SECRET TANIMLI DEĞİL! Bu süreç için rastgele bir secret üretildi.\n   Sunucu her yeniden başladığında tüm oturumlar geçersiz olur ve birden fazla\n   süreç/instance birbirinin tokenlarını tanımaz. Kalıcı bir değer ayarlayın:\n   JWT_SECRET=$(openssl rand -base64 48)\n${line}\n`);
    return crypto.randomBytes(64).toString('hex');
};

const JWT_SECRET = resolveJwtSecret();
const JWT_EXPIRES_IN = '24h';

// Tokens carry an HMAC fingerprint of the stored password hash, so changing a password
// (or the transparent plaintext->bcrypt migration) revokes every token issued before it.
const passwordFingerprint = (passwordHash) =>
    crypto.createHmac('sha256', JWT_SECRET).update(String(passwordHash || '')).digest('base64url').slice(0, 22);

const signToken = (userRow) => jwt.sign(
    {
        userId: userRow.id,
        username: userRow.username,
        role: userRow.role,
        pwv: passwordFingerprint(userRow.password)
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: JWT_EXPIRES_IN }
);

// Constant-time comparison for secrets of arbitrary length.
const safeEqual = (a, b) => {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
};

// Used to keep login timing similar whether or not the username exists.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

// ===== APP / PROXY / CORS =====
app.disable('x-powered-by');

const parseTrustProxy = (raw) => {
    if (raw === undefined || raw === '') return 'loopback';
    if (/^\d+$/.test(raw)) return Number(raw);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return raw;
};
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

if (allowedOrigins.length === 0) {
    console.warn('⚠️  ALLOWED_ORIGINS tanımlı değil: CORS tüm originlere açık. Production için virgülle ayrılmış izinli originleri ayarlayın.');
}

const corsOrigin = allowedOrigins.length === 0
    ? '*'
    : (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin));

app.use(cors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Cross-origin requests (Binance REST) must not carry our punycode domain as Referer: Binance's WAF rejects them with 403.
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
});

app.use(express.json({ limit: '100kb' }));

const io = new Server(server, {
    cors: {
        origin: corsOrigin,
        methods: ['GET', 'POST']
    }
});

// ===== RATE LIMITERS =====
const clientIpKey = (req) => ipKeyGenerator(req.ip || (req.socket && req.socket.remoteAddress) || '');

const limiterDefaults = {
    standardHeaders: 'draft-7',
    legacyHeaders: false
};

const loginLimiter = rateLimit({
    ...limiterDefaults,
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
        const username = req.body && typeof req.body.username === 'string' ? req.body.username : '';
        return `${clientIpKey(req)}|${username.trim().toLowerCase().slice(0, 100)}`;
    },
    message: { error: 'Çok fazla başarısız giriş denemesi. Lütfen 15 dakika sonra tekrar deneyin.' }
});

// Secondary, looser per-IP limit so one IP cannot spray many usernames.
const loginIpLimiter = rateLimit({
    ...limiterDefaults,
    windowMs: 15 * 60 * 1000,
    limit: 100,
    skipSuccessfulRequests: true,
    keyGenerator: clientIpKey,
    message: { error: 'Çok fazla başarısız giriş denemesi. Lütfen 15 dakika sonra tekrar deneyin.' }
});

const registerLimiter = rateLimit({
    ...limiterDefaults,
    windowMs: 60 * 60 * 1000,
    limit: 5,
    keyGenerator: clientIpKey,
    message: { error: 'Çok fazla kayıt denemesi. Lütfen daha sonra tekrar deneyin.' }
});

const webhookLimiter = rateLimit({
    ...limiterDefaults,
    windowMs: 60 * 1000,
    limit: 100,
    keyGenerator: clientIpKey,
    message: { error: 'Çok fazla webhook isteği. Lütfen bir dakika sonra tekrar deneyin.' }
});

const analyzeLimiter = rateLimit({
    ...limiterDefaults,
    windowMs: 60 * 1000,
    limit: 20,
    keyGenerator: (req) => `user:${req.user.userId}`,
    message: { error: 'Çok fazla analiz isteği. Lütfen bir dakika sonra tekrar deneyin.' }
});

const telegramLimiter = rateLimit({
    ...limiterDefaults,
    windowMs: 60 * 1000,
    limit: 30,
    keyGenerator: (req) => `user:${req.user.userId}`,
    message: { error: 'Çok fazla Telegram bildirimi. Lütfen bir dakika sonra tekrar deneyin.' }
});

// ===== USER HELPERS =====
const USER_COLUMNS = 'id, email, name, username, role, status, created_at, updated_at, permissions, last_login';

const parsePermissions = (raw) => {
    let list = raw;
    if (typeof raw === 'string') {
        try {
            list = JSON.parse(raw || '[]');
        } catch {
            list = [];
        }
    }
    return Array.isArray(list) ? list.filter(p => typeof p === 'string') : [];
};

const toEpoch = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

// Single DB-row -> API mapper (camelCase, matches the frontend User type, never includes password).
const toUserDto = (row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    username: row.username,
    role: row.role,
    status: row.status,
    createdAt: toEpoch(row.created_at),
    updatedAt: toEpoch(row.updated_at),
    permissions: parsePermissions(row.permissions),
    lastLogin: toEpoch(row.last_login)
});

// Full rows (including password hash) for internal use only.
const getUserRowById = async (id) => {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
};

const getUserRowByUsername = async (username) => {
    const [rows] = await db.query('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
    return rows[0] || null;
};

const countOtherActiveAdmins = async (excludeUserId) => {
    const [rows] = await db.query(
        "SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND status = 'active' AND id <> ?",
        [excludeUserId]
    );
    return Number(rows[0] && rows[0].total) || 0;
};

const verifyPassword = async (plain, stored) => {
    if (typeof plain !== 'string' || typeof stored !== 'string' || stored.length === 0) {
        await bcrypt.compare(String(plain || ''), DUMMY_PASSWORD_HASH);
        return false;
    }
    if (BCRYPT_HASH_RE.test(stored)) {
        return bcrypt.compare(plain, stored);
    }
    // Legacy plaintext password: equalize timing with a dummy bcrypt round, then compare in constant time.
    await bcrypt.compare(plain, DUMMY_PASSWORD_HASH);
    return safeEqual(plain, stored);
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,50}$/;

const cleanEmail = (value) => {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    return v.length <= 255 && EMAIL_RE.test(v) ? v : null;
};

const cleanName = (value) => {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    return v.length >= 1 && v.length <= 255 ? v : null;
};

const cleanUsername = (value) => {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    return USERNAME_RE.test(v) ? v : null;
};

const passwordProblem = (value) => {
    if (typeof value !== 'string' || value.length < MIN_PASSWORD_LENGTH) {
        return `Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalıdır.`;
    }
    if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES) {
        return `Şifre en fazla ${MAX_PASSWORD_BYTES} bayt olabilir.`;
    }
    return null;
};

const cleanPermissions = (value) => {
    if (!Array.isArray(value)) return null;
    return [...new Set(value.filter(p => typeof p === 'string' && PERMISSIONS.includes(p)))];
};

// Order/duplicate-insensitive comparison key for permission lists.
const permissionsKey = (list) => JSON.stringify([...new Set(list)].sort());

// True when a submitted string equals the stored column value (both trimmed; NULL counts as '').
const sameAsStored = (input, stored) =>
    typeof input === 'string' && input.trim() === (stored === null || stored === undefined ? '' : String(stored).trim());

const duplicateUserMessage = (err) => {
    const text = String(err.sqlMessage || err.message || '');
    if (/email/i.test(text)) return 'Bu e-posta adresi zaten kullanılıyor.';
    if (/username/i.test(text)) return 'Bu kullanıcı adı zaten kullanılıyor.';
    return 'Bu e-posta adresi veya kullanıcı adı zaten kullanılıyor.';
};

const newUserId = () => `user_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

// ===== AUTH MIDDLEWARE =====
// Verifies the JWT and re-loads the user from the DB on every request: deleted/inactive users and
// tokens issued before a password change are rejected, and the role always comes from the DB.
const authenticateToken = async (req, res, next) => {
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? header.match(/^Bearer\s+(\S+)$/i) : null;
    if (!match) {
        return res.status(401).json({ error: 'Oturum açmanız gerekiyor.' });
    }

    let payload;
    try {
        payload = jwt.verify(match[1], JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
        return res.status(401).json({ error: 'Oturumunuz geçersiz veya süresi dolmuş. Lütfen tekrar giriş yapın.' });
    }

    if (!payload || typeof payload.userId !== 'string' || typeof payload.pwv !== 'string') {
        return res.status(401).json({ error: 'Oturumunuz geçersiz. Lütfen tekrar giriş yapın.' });
    }

    const row = await getUserRowById(payload.userId);
    if (!row || row.status !== 'active' || !safeEqual(payload.pwv, passwordFingerprint(row.password))) {
        return res.status(401).json({ error: 'Oturumunuz sonlandırıldı. Lütfen tekrar giriş yapın.' });
    }

    req.user = { userId: row.id, username: row.username, role: row.role };
    req.userRow = row;
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Bu işlem için yönetici yetkisi gerekiyor.' });
    }
    next();
};

// ===== SIGNAL HELPERS =====
// signals.time is a VARCHAR. migrate-alerts-portfolio.cjs adds a numeric `time_ms` column (+ index);
// when it exists we order by it, otherwise we fall back to the (server-generated, ISO-8601) time string.
let signalsTimeMsAvailable = null;
let signalsTimeMsCheckedAt = 0;
const hasSignalsTimeMs = async () => {
    if (signalsTimeMsAvailable === true) return true;
    if (signalsTimeMsAvailable === false && Date.now() - signalsTimeMsCheckedAt < 5 * 60 * 1000) return false;
    const [rows] = await db.query(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signals' AND COLUMN_NAME = 'time_ms'"
    );
    signalsTimeMsAvailable = rows.length > 0;
    signalsTimeMsCheckedAt = Date.now();
    return signalsTimeMsAvailable;
};

const toSignalDto = (row) => {
    const signal = {
        id: row.id,
        strategy: row.strategy == null ? '' : row.strategy,
        symbol: row.symbol,
        side: row.side,
        price: Number(row.price),
        time: row.time,
        note: row.note == null ? '' : row.note
    };
    if (row.source != null) signal.source = row.source;
    if (row.confidence != null) signal.confidence = Number(row.confidence);
    return signal;
};

const loadSignals = async (limit) => {
    const orderBy = (await hasSignalsTimeMs()) ? 'time_ms DESC, time DESC' : 'time DESC';
    const [rows] = await db.query(
        `SELECT id, strategy, symbol, side, price, time, note, source, confidence FROM signals ORDER BY ${orderBy} LIMIT ?`,
        [limit]
    );
    return rows.map(toSignalDto);
};

// Always tries the time_ms column first instead of trusting the cached "missing" answer: if the migration
// adds the column while the server runs, rows inserted during the cache window would otherwise keep a
// NULL time_ms forever, sort last under `ORDER BY time_ms DESC` and drop out of GET /api/signals.
const insertSignal = async (signal, timeMs) => {
    try {
        await db.query(
            'INSERT INTO signals (id, strategy, symbol, side, price, time, time_ms, note, source, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [signal.id, signal.strategy, signal.symbol, signal.side, signal.price, signal.time, timeMs, signal.note, signal.source, signal.confidence]
        );
        signalsTimeMsAvailable = true;
        return;
    } catch (err) {
        if (err.code !== 'ER_BAD_FIELD_ERROR') throw err;
        signalsTimeMsAvailable = false;
        signalsTimeMsCheckedAt = Date.now();
    }
    await db.query(
        'INSERT INTO signals (id, strategy, symbol, side, price, time, note, source, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [signal.id, signal.strategy, signal.symbol, signal.side, signal.price, signal.time, signal.note, signal.source, signal.confidence]
    );
};

const parsePositiveNumber = (value) => {
    let n = NaN;
    if (typeof value === 'number') n = value;
    else if (typeof value === 'string' && value.trim() !== '') n = Number(value.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
};

const isBlank = (value) => value === undefined || value === null || value === '';

const validateSignalInput = (data, options) => {
    if (!isPlainObject(data)) return { error: 'Geçersiz istek gövdesi: JSON nesnesi bekleniyor.' };

    const symbol = typeof data.symbol === 'string' ? data.symbol.trim().toUpperCase() : '';
    if (!symbol) return { error: 'symbol alanı zorunludur.' };
    if (symbol.length > 20 || !/^[A-Z0-9._:/-]+$/.test(symbol)) {
        return { error: 'symbol geçersiz (en fazla 20 karakter; harf, rakam ve . _ : / - kullanılabilir).' };
    }

    const side = typeof data.side === 'string' ? data.side.trim().toUpperCase() : '';
    if (!SIGNAL_SIDES.includes(side)) return { error: 'side alanı BUY, SELL, LONG veya SHORT olmalıdır.' };

    const price = parsePositiveNumber(data.price);
    if (price === null || price >= MAX_PRICE) return { error: 'price alanı sıfırdan büyük geçerli bir sayı olmalıdır.' };

    let strategy = options.defaultStrategy;
    if (!isBlank(data.strategy)) {
        if (typeof data.strategy !== 'string' || !data.strategy.trim() || data.strategy.trim().length > 100) {
            return { error: 'strategy en fazla 100 karakterlik bir metin olmalıdır.' };
        }
        strategy = data.strategy.trim();
    }

    let note = options.defaultNote;
    if (!isBlank(data.note)) {
        if (typeof data.note !== 'string' || data.note.length > 1000) {
            return { error: 'note en fazla 1000 karakterlik bir metin olmalıdır.' };
        }
        note = data.note.trim() || options.defaultNote;
    }

    let source = options.defaultSource;
    if (options.allowSource && !isBlank(data.source)) {
        const candidate = typeof data.source === 'string' ? data.source.trim().toUpperCase() : '';
        if (!SIGNAL_SOURCES.includes(candidate)) {
            return { error: `source şu değerlerden biri olmalıdır: ${SIGNAL_SOURCES.join(', ')}.` };
        }
        source = candidate;
    }

    let confidence = 0.95;
    if (!isBlank(data.confidence)) {
        let c = typeof data.confidence === 'number' ? data.confidence : (typeof data.confidence === 'string' ? Number(data.confidence) : NaN);
        if (Number.isFinite(c) && c > 1 && c <= 100) c = c / 100; // accept percentages (e.g. 85)
        if (!Number.isFinite(c) || c < 0 || c > 1) {
            return { error: 'confidence 0 ile 1 arasında bir sayı olmalıdır.' };
        }
        confidence = c;
    }

    return { value: { symbol, side, price, strategy, note, source, confidence } };
};

// Insert FIRST; broadcast only after the row is safely stored. Throws on DB failure.
const createAndBroadcastSignal = async (value) => {
    const now = Date.now();
    const signal = {
        id: crypto.randomUUID(),
        strategy: value.strategy,
        symbol: value.symbol,
        side: value.side,
        price: value.price,
        time: new Date(now).toISOString(),
        note: value.note,
        source: value.source,
        confidence: value.confidence
    };
    await insertSignal(signal, now);
    io.emit('new_signal', signal);
    return signal;
};

// Webhook de-duplication: same strategy + symbol + side within 60 seconds is ignored.
const recentWebhookSignals = new Map();
const pruneRecentWebhookSignals = (now) => {
    for (const [key, at] of recentWebhookSignals) {
        if (now - at >= SIGNAL_DEDUP_WINDOW_MS) recentWebhookSignals.delete(key);
    }
};

// ===== PRICE ALERT HELPERS =====
const toAlertDto = (row) => ({
    id: row.id,
    symbol: row.symbol,
    targetPrice: parseFloat(row.target_price),
    condition: row.condition_type,
    isActive: row.is_active === 1 || row.is_active === true,
    createdAt: toEpoch(row.created_at)
});

const loadPriceAlerts = async (userId) => {
    const [rows] = await db.query('SELECT * FROM price_alerts WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    return rows.map(toAlertDto);
};

// ===== PORTFOLIO HELPERS =====
const toHoldingDto = (row) => ({
    id: row.id,
    symbol: row.symbol,
    qty: parseFloat(row.quantity),
    costBasis: parseFloat(row.cost_basis)
});

const loadPortfolio = async (userId) => {
    const [holdings] = await db.query('SELECT * FROM portfolio_holdings WHERE user_id = ?', [userId]);
    const [trades] = await db.query('SELECT * FROM trade_history WHERE user_id = ? ORDER BY timestamp DESC', [userId]);
    return {
        holdings: holdings.map(toHoldingDto),
        trades: trades.map(t => ({
            id: t.id,
            symbol: t.symbol,
            side: t.side,
            qty: parseFloat(t.quantity),
            price: parseFloat(t.price),
            timestamp: toEpoch(t.timestamp)
        }))
    };
};

// Adds qty at `price` to the (user, symbol) holding: increases the quantity and recomputes the
// weighted average cost. Works with the pool or a transaction connection. Returns the real DB row.
const addToHolding = async (conn, userId, symbol, qty, price) => {
    const now = Date.now();
    const [result] = await conn.query(
        `INSERT INTO portfolio_holdings (id, user_id, symbol, quantity, cost_basis, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            cost_basis = (quantity * cost_basis + VALUES(quantity) * VALUES(cost_basis)) / (quantity + VALUES(quantity)),
            quantity = quantity + VALUES(quantity),
            updated_at = VALUES(updated_at)`,
        [`holding_${crypto.randomUUID()}`, userId, symbol, qty, price, now, now]
    );
    const [rows] = await conn.query(
        'SELECT id, symbol, quantity, cost_basis FROM portfolio_holdings WHERE user_id = ? AND symbol = ? LIMIT 1',
        [userId, symbol]
    );
    return { created: result.affectedRows === 1, holding: rows[0] ? toHoldingDto(rows[0]) : null };
};

const cleanSymbol = (value) => {
    if (typeof value !== 'string') return null;
    const v = value.trim().toUpperCase();
    return v.length >= 1 && v.length <= 50 && /^[A-Z0-9._:/-]+$/.test(v) ? v : null;
};

const parseNonNegativeNumber = (value) => {
    let n = NaN;
    if (typeof value === 'number') n = value;
    else if (typeof value === 'string' && value.trim() !== '') n = Number(value.trim());
    return Number.isFinite(n) && n >= 0 ? n : null;
};

// ===== API ROUTES =====

// Get Signals (public read, newest first)
app.get('/api/signals', async (req, res) => {
    let limit = SIGNALS_DEFAULT_LIMIT;
    if (req.query.limit !== undefined) {
        const parsed = Number.parseInt(String(req.query.limit), 10);
        if (!Number.isFinite(parsed) || parsed < 1) {
            return res.status(400).json({ error: `limit 1 ile ${SIGNALS_MAX_LIMIT} arasında bir tam sayı olmalıdır.` });
        }
        limit = Math.min(parsed, SIGNALS_MAX_LIMIT);
    }
    const signals = await loadSignals(limit);
    res.json(signals);
});

// TradingView webhook: JSON body {secret, symbol, side, price, strategy?, note?}
app.post('/api/webhook', webhookLimiter, express.text({ type: 'text/*', limit: '20kb' }), async (req, res) => {
    const expectedSecret = process.env.WEBHOOK_SECRET;
    if (!expectedSecret) {
        return res.status(503).json({ error: 'Webhook devre dışı: sunucuda WEBHOOK_SECRET tanımlı değil.' });
    }

    let data = req.body;
    if (typeof data === 'string') {
        try {
            data = JSON.parse(data);
        } catch {
            data = null;
        }
    }
    if (!isPlainObject(data)) {
        return res.status(400).json({ error: 'Geçersiz istek gövdesi: JSON nesnesi bekleniyor.' });
    }

    if (typeof data.secret !== 'string' || data.secret.length === 0 || !safeEqual(data.secret, expectedSecret)) {
        console.warn(`[webhook] Geçersiz secret ile istek reddedildi (ip: ${req.ip})`);
        return res.status(401).json({ error: 'Geçersiz webhook secret.' });
    }

    const parsed = validateSignalInput(data, {
        allowSource: false,
        defaultStrategy: 'External_Webhook',
        defaultNote: 'Received via Webhook',
        defaultSource: 'WEBHOOK'
    });
    if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
    }

    const now = Date.now();
    pruneRecentWebhookSignals(now);
    const dedupKey = `${parsed.value.strategy}|${parsed.value.symbol}|${parsed.value.side}`;
    if (recentWebhookSignals.has(dedupKey)) {
        return res.status(200).json({ duplicate: true });
    }
    // Reserve synchronously so concurrent identical requests are also de-duplicated.
    recentWebhookSignals.set(dedupKey, now);

    try {
        const signal = await createAndBroadcastSignal(parsed.value);
        console.log(`[webhook] Sinyal kaydedildi: ${signal.symbol} ${signal.side} (${signal.strategy}) ip=${req.ip}`);
        return res.status(201).json({ signal });
    } catch (err) {
        recentWebhookSignals.delete(dedupKey);
        console.error('[webhook] Sinyal veritabanına yazılamadı:', err.code || err.message);
        return res.status(500).json({ error: 'Sinyal kaydedilemedi.' });
    }
});

// Manual signal injection from the app (admin only). Same validation/broadcast as the webhook.
app.post('/api/signals', authenticateToken, requireAdmin, async (req, res) => {
    const parsed = validateSignalInput(req.body, {
        allowSource: true,
        defaultStrategy: 'Manual_Injection',
        defaultNote: 'Yönetici tarafından manuel eklendi',
        defaultSource: 'MANUAL'
    });
    if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
    }

    try {
        const signal = await createAndBroadcastSignal(parsed.value);
        console.log(`[signals] Manuel sinyal eklendi: ${signal.symbol} ${signal.side} (kullanıcı: ${req.user.username})`);
        return res.status(201).json({ signal });
    } catch (err) {
        console.error('[signals] Manuel sinyal kaydedilemedi:', err.code || err.message);
        return res.status(500).json({ error: 'Sinyal kaydedilemedi.' });
    }
});

// Delete a single signal (admin only)
app.delete('/api/signals/:id', authenticateToken, requireAdmin, async (req, res) => {
    const [result] = await db.query('DELETE FROM signals WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) {
        return res.status(404).json({ error: 'Sinyal bulunamadı.' });
    }
    io.emit('signal_deleted', { id: req.params.id });
    res.json({ success: true });
});

// Delete all signals (admin only)
app.delete('/api/signals', authenticateToken, requireAdmin, async (req, res) => {
    const [result] = await db.query('DELETE FROM signals');
    recentWebhookSignals.clear();
    io.emit('signals_cleared');
    console.log(`[signals] Tüm sinyaller silindi (${result.affectedRows || 0} kayıt, kullanıcı: ${req.user.username})`);
    res.json({ success: true, deleted: result.affectedRows || 0 });
});

// ===== USER MANAGEMENT API =====

// List users (admin only)
app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
    const [rows] = await db.query(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at DESC`);
    res.json(rows.map(toUserDto));
});

// Get single user (admin, or the user themself)
app.get('/api/users/:id', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin' && req.params.id !== req.user.userId) {
        return res.status(403).json({ error: 'Bu kullanıcıyı görüntüleme yetkiniz yok.' });
    }
    const row = await getUserRowById(req.params.id);
    if (!row) {
        return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    }
    res.json(toUserDto(row));
});

// Create user (admin only)
app.post('/api/users', authenticateToken, requireAdmin, async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {};

    const email = cleanEmail(body.email);
    if (!email) return res.status(400).json({ error: 'Geçerli bir e-posta adresi girin.' });
    const name = cleanName(body.name !== undefined ? body.name : body.fullName);
    if (!name) return res.status(400).json({ error: 'Ad soyad zorunludur (en fazla 255 karakter).' });
    const username = cleanUsername(body.username);
    if (!username) return res.status(400).json({ error: 'Kullanıcı adı 3-50 karakter olmalı ve yalnızca harf, rakam, . _ - içermelidir.' });
    const pwProblem = passwordProblem(body.password);
    if (pwProblem) return res.status(400).json({ error: pwProblem });
    if (!USER_ROLES.includes(body.role)) {
        return res.status(400).json({ error: `Rol şu değerlerden biri olmalıdır: ${USER_ROLES.join(', ')}.` });
    }
    let status = 'active';
    if (body.status !== undefined) {
        if (!USER_STATUSES.includes(body.status)) return res.status(400).json({ error: 'Durum active veya inactive olmalıdır.' });
        status = body.status;
    }
    let permissions = [];
    if (body.permissions !== undefined && body.permissions !== null) {
        permissions = cleanPermissions(body.permissions);
        if (!permissions) return res.status(400).json({ error: 'İzinler bir liste olmalıdır.' });
    }

    const now = Date.now();
    const row = {
        id: newUserId(),
        email,
        name,
        username,
        password: await bcrypt.hash(body.password, 10),
        role: body.role,
        status,
        created_at: now,
        updated_at: now,
        permissions: JSON.stringify(permissions),
        last_login: null
    };

    try {
        await db.query(
            'INSERT INTO users (id, email, name, username, password, role, status, created_at, updated_at, permissions, last_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [row.id, row.email, row.name, row.username, row.password, row.role, row.status, row.created_at, row.updated_at, row.permissions, row.last_login]
        );
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: duplicateUserMessage(err) });
        throw err;
    }

    res.status(201).json(toUserDto(row));
});

// Update user. Admin: any field of any user. Others: only their own name/email/password
// (own password change requires currentPassword).
app.put('/api/users/:id', authenticateToken, async (req, res) => {
    const targetId = req.params.id;
    const isAdmin = req.user.role === 'admin';
    const isSelf = targetId === req.user.userId;

    if (!isAdmin && !isSelf) {
        return res.status(403).json({ error: 'Bu kullanıcıyı düzenleme yetkiniz yok.' });
    }
    if (!isPlainObject(req.body)) {
        return res.status(400).json({ error: 'Geçersiz istek gövdesi.' });
    }
    const body = req.body;

    const target = await getUserRowById(targetId);
    if (!target) {
        return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    }

    const changes = {};

    // Every field is first compared with the stored value and only validated when it actually changes:
    // legacy rows (created before format checks existed) may hold values the new rules reject, and the
    // edit modal always sends every field back, so validating unchanged values would block any edit.

    // --- Fields every user may change on their own record ---
    const nameInput = body.name !== undefined ? body.name : body.fullName;
    if (nameInput !== undefined && !sameAsStored(nameInput, target.name)) {
        const name = cleanName(nameInput);
        if (!name) return res.status(400).json({ error: 'Ad soyad zorunludur (en fazla 255 karakter).' });
        changes.name = name;
    }
    if (body.email !== undefined && !sameAsStored(body.email, target.email)) {
        const email = cleanEmail(body.email);
        if (!email) return res.status(400).json({ error: 'Geçerli bir e-posta adresi girin.' });
        changes.email = email;
    }

    // --- Admin-only fields (sending the unchanged current value is allowed for everyone) ---
    const adminChanges = {};
    if (body.username !== undefined && !sameAsStored(body.username, target.username)) {
        const username = cleanUsername(body.username);
        if (!username) return res.status(400).json({ error: 'Kullanıcı adı 3-50 karakter olmalı ve yalnızca harf, rakam, . _ - içermelidir.' });
        adminChanges.username = username;
    }
    if (body.role !== undefined && body.role !== target.role) {
        if (!USER_ROLES.includes(body.role)) {
            return res.status(400).json({ error: `Rol şu değerlerden biri olmalıdır: ${USER_ROLES.join(', ')}.` });
        }
        adminChanges.role = body.role;
    }
    if (body.status !== undefined && body.status !== target.status) {
        if (!USER_STATUSES.includes(body.status)) return res.status(400).json({ error: 'Durum active veya inactive olmalıdır.' });
        adminChanges.status = body.status;
    }
    if (body.permissions !== undefined && body.permissions !== null) {
        const permissions = cleanPermissions(body.permissions);
        if (!permissions) return res.status(400).json({ error: 'İzinler bir liste olmalıdır.' });
        const current = parsePermissions(target.permissions);
        // Unchanged if the raw lists match (legacy, non-whitelisted entries sent back as-is) or if they
        // only differ in such legacy entries.
        const unchanged =
            permissionsKey(body.permissions.filter(p => typeof p === 'string')) === permissionsKey(current) ||
            permissionsKey(permissions) === permissionsKey(cleanPermissions(current));
        if (!unchanged) adminChanges.permissions = JSON.stringify(permissions);
    }

    if (Object.keys(adminChanges).length > 0 && !isAdmin) {
        return res.status(403).json({ error: 'Kullanıcı adınızı, rolünüzü, durumunuzu veya izinlerinizi değiştiremezsiniz.' });
    }

    // Never leave the system without an active admin.
    const losesAdmin = target.role === 'admin' && target.status === 'active' &&
        ((adminChanges.role !== undefined && adminChanges.role !== 'admin') || adminChanges.status === 'inactive');
    if (losesAdmin && (await countOtherActiveAdmins(target.id)) === 0) {
        return res.status(409).json({ error: 'Son aktif yönetici hesabının rolü veya durumu değiştirilemez.' });
    }

    // --- Password ---
    if (!isBlank(body.password)) {
        const pwProblem = passwordProblem(body.password);
        if (pwProblem) return res.status(400).json({ error: pwProblem });
        if (isSelf) {
            if (typeof body.currentPassword !== 'string' || body.currentPassword.length === 0) {
                return res.status(400).json({ error: 'Kendi şifrenizi değiştirmek için mevcut şifrenizi girin.' });
            }
            if (!(await verifyPassword(body.currentPassword, target.password))) {
                return res.status(400).json({ error: 'Mevcut şifre hatalı.' });
            }
        }
        changes.password = await bcrypt.hash(body.password, 10);
    }

    Object.assign(changes, adminChanges);
    const columns = Object.keys(changes);
    if (columns.length === 0) {
        return res.json(toUserDto(target));
    }

    const assignments = columns.map(column => `${column} = ?`);
    const values = columns.map(column => changes[column]);
    assignments.push('updated_at = ?');
    values.push(Date.now(), targetId);

    try {
        await db.query(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`, values);
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: duplicateUserMessage(err) });
        throw err;
    }

    const updated = await getUserRowById(targetId);
    if (!updated) {
        return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    }
    res.json(toUserDto(updated));
});

// Delete user (admin only). Removes the user's alerts, holdings and trades in the same transaction.
app.delete('/api/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    const targetId = req.params.id;
    const target = await getUserRowById(targetId);
    if (!target) {
        return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    }
    if (target.role === 'admin' && target.status === 'active' && (await countOtherActiveAdmins(targetId)) === 0) {
        return res.status(409).json({ error: 'Son aktif yönetici hesabı silinemez.' });
    }

    const conn = await db.getConnection();
    let deleted = false;
    try {
        await conn.beginTransaction();
        for (const table of ['price_alerts', 'portfolio_holdings', 'trade_history']) {
            try {
                await conn.query(`DELETE FROM ${table} WHERE user_id = ?`, [targetId]);
            } catch (err) {
                // Tables are optional until migrate-alerts-portfolio.cjs has been run.
                if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
            }
        }
        const [result] = await conn.query('DELETE FROM users WHERE id = ?', [targetId]);
        deleted = result.affectedRows > 0;
        if (deleted) {
            await conn.commit();
        } else {
            await conn.rollback();
        }
    } catch (err) {
        try { await conn.rollback(); } catch { /* ignore */ }
        throw err;
    } finally {
        conn.release();
    }

    if (!deleted) {
        return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    }
    res.json({ success: true, message: 'Kullanıcı silindi.' });
});

// ===== PRICE ALERTS API =====

app.get('/api/alerts', authenticateToken, async (req, res) => {
    res.json(await loadPriceAlerts(req.user.userId));
});

app.post('/api/alerts', authenticateToken, async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {};
    const symbol = cleanSymbol(body.symbol);
    if (!symbol) return res.status(400).json({ error: 'Geçerli bir sembol girin.' });
    const targetPrice = parsePositiveNumber(body.targetPrice);
    if (targetPrice === null || targetPrice >= MAX_PRICE) return res.status(400).json({ error: 'Hedef fiyat sıfırdan büyük geçerli bir sayı olmalıdır.' });
    const condition = typeof body.condition === 'string' ? body.condition.trim().toUpperCase() : '';
    if (!['ABOVE', 'BELOW'].includes(condition)) return res.status(400).json({ error: 'Koşul ABOVE veya BELOW olmalıdır.' });

    const alert = {
        id: `alert_${crypto.randomUUID()}`,
        symbol,
        targetPrice,
        condition,
        isActive: true,
        createdAt: Date.now()
    };

    await db.query(
        'INSERT INTO price_alerts (id, user_id, symbol, target_price, condition_type, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [alert.id, req.user.userId, alert.symbol, alert.targetPrice, alert.condition, 1, alert.createdAt]
    );
    res.status(201).json(alert);
});

app.put('/api/alerts/:id', authenticateToken, async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {};
    const fields = [];
    const values = [];

    if (body.isActive !== undefined) {
        if (typeof body.isActive !== 'boolean') return res.status(400).json({ error: 'isActive true veya false olmalıdır.' });
        fields.push('is_active = ?');
        values.push(body.isActive ? 1 : 0);
    }
    if (body.targetPrice !== undefined) {
        const targetPrice = parsePositiveNumber(body.targetPrice);
        if (targetPrice === null || targetPrice >= MAX_PRICE) return res.status(400).json({ error: 'Hedef fiyat sıfırdan büyük geçerli bir sayı olmalıdır.' });
        fields.push('target_price = ?');
        values.push(targetPrice);
    }
    if (fields.length === 0) {
        return res.status(400).json({ error: 'Güncellenecek alan yok (isActive veya targetPrice).' });
    }

    values.push(req.params.id, req.user.userId);
    const [result] = await db.query(`UPDATE price_alerts SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
    if (!result.affectedRows) {
        return res.status(404).json({ error: 'Alarm bulunamadı.' });
    }
    res.json({ success: true });
});

app.delete('/api/alerts/:id', authenticateToken, async (req, res) => {
    const [result] = await db.query('DELETE FROM price_alerts WHERE id = ? AND user_id = ?', [req.params.id, req.user.userId]);
    if (!result.affectedRows) {
        return res.status(404).json({ error: 'Alarm bulunamadı.' });
    }
    res.json({ success: true });
});

// ===== PORTFOLIO API =====

app.get('/api/portfolio', authenticateToken, async (req, res) => {
    res.json(await loadPortfolio(req.user.userId));
});

// Add to a holding: a second purchase of the same symbol increases the quantity and
// recomputes the weighted average cost. Returns the real DB row.
app.post('/api/portfolio/holdings', authenticateToken, async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {};
    const symbol = cleanSymbol(body.symbol);
    if (!symbol) return res.status(400).json({ error: 'Geçerli bir sembol girin.' });
    const qty = parsePositiveNumber(body.qty);
    if (qty === null || qty >= MAX_PRICE) return res.status(400).json({ error: 'Miktar sıfırdan büyük geçerli bir sayı olmalıdır.' });
    const costBasis = parseNonNegativeNumber(body.costBasis);
    if (costBasis === null || costBasis >= MAX_PRICE) return res.status(400).json({ error: 'Maliyet sıfır veya daha büyük geçerli bir sayı olmalıdır.' });

    const { created, holding } = await addToHolding(db, req.user.userId, symbol, qty, costBasis);
    res.status(created ? 201 : 200).json(holding);
});

app.delete('/api/portfolio/holdings/:id', authenticateToken, async (req, res) => {
    const [result] = await db.query('DELETE FROM portfolio_holdings WHERE id = ? AND user_id = ?', [req.params.id, req.user.userId]);
    if (!result.affectedRows) {
        return res.status(404).json({ error: 'Pozisyon bulunamadı.' });
    }
    res.json({ success: true });
});

// Record a trade and update the matching holding in a single transaction.
app.post('/api/portfolio/trades', authenticateToken, async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {};
    const symbol = cleanSymbol(body.symbol);
    if (!symbol) return res.status(400).json({ error: 'Geçerli bir sembol girin.' });
    const side = typeof body.side === 'string' ? body.side.trim().toUpperCase() : '';
    if (!['BUY', 'SELL'].includes(side)) return res.status(400).json({ error: 'İşlem yönü BUY veya SELL olmalıdır.' });
    const qty = parsePositiveNumber(body.qty);
    if (qty === null || qty >= MAX_PRICE) return res.status(400).json({ error: 'Miktar sıfırdan büyük geçerli bir sayı olmalıdır.' });
    const price = parsePositiveNumber(body.price);
    if (price === null || price >= MAX_PRICE) return res.status(400).json({ error: 'Fiyat sıfırdan büyük geçerli bir sayı olmalıdır.' });

    const userId = req.user.userId;
    const trade = {
        id: `trade_${crypto.randomUUID()}`,
        symbol,
        side,
        qty,
        price,
        timestamp: Date.now()
    };

    const conn = await db.getConnection();
    let holding = null;
    try {
        await conn.beginTransaction();
        await conn.query(
            'INSERT INTO trade_history (id, user_id, symbol, side, quantity, price, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [trade.id, userId, trade.symbol, trade.side, trade.qty, trade.price, trade.timestamp]
        );

        if (side === 'BUY') {
            holding = (await addToHolding(conn, userId, symbol, qty, price)).holding;
        } else {
            const [rows] = await conn.query(
                'SELECT id, symbol, quantity, cost_basis FROM portfolio_holdings WHERE user_id = ? AND symbol = ? LIMIT 1 FOR UPDATE',
                [userId, symbol]
            );
            const current = rows[0];
            const heldQty = current ? parseFloat(current.quantity) : 0;
            if (!current || qty > heldQty + 1e-8) {
                await conn.rollback();
                return res.status(400).json({ error: 'Satış miktarı mevcut pozisyondan büyük olamaz.' });
            }
            const remaining = heldQty - qty;
            if (remaining <= 1e-8) {
                await conn.query('DELETE FROM portfolio_holdings WHERE id = ?', [current.id]);
                holding = null;
            } else {
                await conn.query('UPDATE portfolio_holdings SET quantity = ?, updated_at = ? WHERE id = ?', [remaining, Date.now(), current.id]);
                holding = { ...toHoldingDto(current), qty: remaining };
            }
        }

        await conn.commit();
    } catch (err) {
        try { await conn.rollback(); } catch { /* ignore */ }
        throw err;
    } finally {
        conn.release();
    }

    res.status(201).json({ ...trade, holding });
});

// ===== AUTHENTICATION =====

// Self-registration is disabled unless ALLOW_REGISTRATION=true (the frontend has no signup UI).
app.post('/api/auth/register', registerLimiter, async (req, res) => {
    if (process.env.ALLOW_REGISTRATION !== 'true') {
        return res.status(403).json({ error: 'Yeni kayıt kapalı. Hesap için yöneticinize başvurun.' });
    }

    const body = isPlainObject(req.body) ? req.body : {};
    const email = cleanEmail(body.email);
    if (!email) return res.status(400).json({ error: 'Geçerli bir e-posta adresi girin.' });
    const name = cleanName(body.name !== undefined ? body.name : body.fullName);
    if (!name) return res.status(400).json({ error: 'Ad soyad zorunludur (en fazla 255 karakter).' });
    const username = cleanUsername(body.username);
    if (!username) return res.status(400).json({ error: 'Kullanıcı adı 3-50 karakter olmalı ve yalnızca harf, rakam, . _ - içermelidir.' });
    const pwProblem = passwordProblem(body.password);
    if (pwProblem) return res.status(400).json({ error: pwProblem });

    const now = Date.now();
    const row = {
        id: newUserId(),
        email,
        name,
        username,
        password: await bcrypt.hash(body.password, 10),
        role: 'trader', // always; never taken from the request
        status: 'active',
        created_at: now,
        updated_at: now,
        permissions: JSON.stringify(['view_dashboard', 'manage_trades']),
        last_login: null
    };

    try {
        await db.query(
            'INSERT INTO users (id, email, name, username, password, role, status, created_at, updated_at, permissions, last_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [row.id, row.email, row.name, row.username, row.password, row.role, row.status, row.created_at, row.updated_at, row.permissions, row.last_login]
        );
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: duplicateUserMessage(err) });
        throw err;
    }

    res.status(201).json({ success: true, token: signToken(row), user: toUserDto(row) });
});

// Login
app.post('/api/auth/login', loginIpLimiter, loginLimiter, async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {};
    const { username, password } = body;

    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
        return res.status(400).json({ error: 'Kullanıcı adı ve şifre zorunludur.' });
    }
    if (username.length > 255 || password.length > 1024) {
        return res.status(400).json({ error: 'Kullanıcı adı veya şifre çok uzun.' });
    }

    const user = await getUserRowByUsername(username);
    if (!user) {
        await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
        return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
    }

    const storedPassword = typeof user.password === 'string' ? user.password : '';
    const isHashed = BCRYPT_HASH_RE.test(storedPassword);
    if (!(await verifyPassword(password, storedPassword))) {
        return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
    }

    // Transparent migration: a legacy plaintext password that just matched is re-hashed immediately,
    // so it never stays in plaintext after its owner's next successful login.
    if (!isHashed) {
        const hashed = await bcrypt.hash(password, 10);
        await db.query('UPDATE users SET password = ? WHERE id = ? AND password = ?', [hashed, user.id, storedPassword]);
        user.password = hashed;
        console.log(`[auth] "${user.username}" kullanıcısının düz metin şifresi bcrypt'e taşındı.`);
    }

    if (user.status !== 'active') {
        return res.status(403).json({ error: 'Hesabınız devre dışı bırakılmış. Yöneticinize başvurun.' });
    }

    const now = Date.now();
    await db.query('UPDATE users SET last_login = ? WHERE id = ?', [now, user.id]);
    user.last_login = now;

    res.json({
        success: true,
        token: signToken(user),
        user: toUserDto(user)
    });
});

// Current user
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    res.json({ user: toUserDto(req.userRow) });
});

// ===== TELEGRAM NOTIFICATIONS =====
// Replaces the former generic /api/forward proxy: the only outbound host is api.telegram.org.
const TELEGRAM_TOKEN_RE = /^\d{3,20}:[A-Za-z0-9_-]{20,100}$/;
const TELEGRAM_CHAT_ID_RE = /^(-?\d{1,20}|@[A-Za-z0-9_]{4,64})$/;
const TELEGRAM_PARSE_MODES = ['HTML', 'Markdown', 'MarkdownV2'];

app.post('/api/notify/telegram', authenticateToken, telegramLimiter, async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {};
    const botToken = typeof body.botToken === 'string' ? body.botToken.trim() : '';
    if (!TELEGRAM_TOKEN_RE.test(botToken)) {
        return res.status(400).json({ error: 'Geçersiz Telegram bot token.' });
    }
    const chatId = typeof body.chatId === 'number' && Number.isInteger(body.chatId)
        ? String(body.chatId)
        : (typeof body.chatId === 'string' ? body.chatId.trim() : '');
    if (!TELEGRAM_CHAT_ID_RE.test(chatId)) {
        return res.status(400).json({ error: 'Geçersiz Telegram sohbet (chat) ID.' });
    }
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4096) {
        return res.status(400).json({ error: 'Mesaj metni 1-4096 karakter olmalıdır.' });
    }
    if (!isBlank(body.parseMode) && !TELEGRAM_PARSE_MODES.includes(body.parseMode)) {
        return res.status(400).json({ error: `parseMode şu değerlerden biri olmalıdır: ${TELEGRAM_PARSE_MODES.join(', ')}.` });
    }

    const payload = {
        chat_id: chatId,
        text: body.text,
        disable_web_page_preview: true
    };
    if (!isBlank(body.parseMode)) payload.parse_mode = body.parseMode;

    let telegramResponse;
    try {
        telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            redirect: 'error',
            signal: AbortSignal.timeout(10000)
        });
    } catch (err) {
        // Never log the URL (it contains the bot token).
        console.warn('[telegram] Telegram API\'ye ulaşılamadı:', err && err.name);
        return res.status(502).json({ error: 'Telegram sunucusuna ulaşılamadı.' });
    }

    let data = null;
    try {
        data = await telegramResponse.json();
    } catch { /* non-JSON response */ }

    if (telegramResponse.ok && data && data.ok) {
        return res.json({ ok: true });
    }

    const description = data && typeof data.description === 'string'
        ? data.description.slice(0, 200)
        : `HTTP ${telegramResponse.status}`;
    console.warn(`[telegram] Mesaj gönderilemedi (HTTP ${telegramResponse.status}, kullanıcı: ${req.user.username})`);
    // Never answer 401 here: the frontend treats 401 as "session expired".
    const status = telegramResponse.status === 429 ? 429 : (telegramResponse.status >= 500 ? 502 : 400);
    return res.status(status).json({ error: `Telegram mesajı reddetti: ${description}` });
});

// ===== AI ANALYSIS =====
const { GoogleGenAI } = require('@google/genai');
let ai;
if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} else {
    console.warn('⚠️ GEMINI_API_KEY is not set. AI analysis features will be disabled.');
}

app.post('/api/analyze', authenticateToken, analyzeLimiter, async (req, res) => {
    if (!ai) {
        return res.status(503).json({ error: 'Yapay zekâ servisi kullanılamıyor (GEMINI_API_KEY tanımlı değil).' });
    }

    const body = isPlainObject(req.body) ? req.body : {};
    const { prompt, context } = body;
    if (typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: 'prompt alanı zorunludur.' });
    }
    if (prompt.length > 4000) {
        return res.status(400).json({ error: 'prompt en fazla 4000 karakter olabilir.' });
    }
    if (!isBlank(context) && typeof context !== 'string') {
        return res.status(400).json({ error: 'context bir metin olmalıdır.' });
    }
    if (typeof context === 'string' && context.length > 20000) {
        return res.status(400).json({ error: 'context en fazla 20000 karakter olabilir.' });
    }

    try {
        const systemInstruction = `You are Fidelio, an elite crypto market intelligence analyst.
        Your persona is professional, concise, and data-driven. You speak like a senior trader at a hedge fund.
        You have access to real-time market data provided in the context.
        ALWAYS use the Google Search tool to verify breaking news, macro events, or reasons for sudden price moves.
        When analyzing, combine the technical data provided with the search results.
        Format your responses using Markdown. Use bullet points for readability.
        If you use Google Search, ensure you integrate the findings into your analysis.`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                { role: 'user', parts: [{ text: `[MARKET CONTEXT]\n${context || ''}\n\n[USER QUERY]\n${prompt}` }] }
            ],
            config: {
                systemInstruction: systemInstruction,
                tools: [{ googleSearch: {} }],
                temperature: 0.7,
            },
        });

        const text = response.text || "No analysis generated.";

        // Extract sources
        const sources = [];
        const candidate = response.candidates?.[0];
        if (candidate?.groundingMetadata?.groundingChunks) {
            candidate.groundingMetadata.groundingChunks.forEach((chunk) => {
                if (chunk.web) {
                    sources.push({
                        title: chunk.web.title || 'Source',
                        uri: chunk.web.uri
                    });
                }
            });
        }

        res.json({ text, sources });
    } catch (err) {
        console.error('[ai] Analiz başarısız:', (err && (err.status || err.code || err.name)) || 'bilinmeyen hata');
        res.status(500).json({ error: 'Yapay zekâ analizi başarısız oldu. Lütfen daha sonra tekrar deneyin.' });
    }
});

// ===== HEALTH =====
app.get('/health', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.status(200).json({ status: 'ok', db: 'ok', uptime: process.uptime() });
    } catch (err) {
        console.error('[health] Veritabanı kontrolü başarısız:', err.code || err.message);
        res.status(503).json({ status: 'degraded', db: 'error', uptime: process.uptime() });
    }
});

// ===== UNKNOWN API ROUTES =====
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'İstenen API uç noktası bulunamadı.' });
});

// ===== FRONTEND (single-origin deploy) =====
// When a production build exists in ../dist, serve it with an SPA fallback.
const DIST_DIR = path.join(__dirname, '..', 'dist');
const DIST_INDEX = path.join(DIST_DIR, 'index.html');
if (fs.existsSync(DIST_INDEX)) {
    app.use(express.static(DIST_DIR, { index: false }));
    app.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        if (req.path.startsWith('/socket.io') || path.extname(req.path)) return next();
        res.sendFile(DIST_INDEX);
    });
    console.log(`📦 Frontend build servis ediliyor: ${DIST_DIR}`);
}

app.use((req, res) => {
    res.status(404).json({ error: 'Kaynak bulunamadı.' });
});

// ===== GLOBAL ERROR HANDLER =====
// Never leaks error messages or stack traces to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }
    if (err && err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Geçersiz JSON gövdesi.' });
    }
    if (err && err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'İstek gövdesi çok büyük.' });
    }
    if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
        return res.status(err.status === 401 ? 400 : err.status).json({ error: 'Geçersiz istek.' });
    }
    console.error(`[hata] ${req.method} ${req.path}:`, err && (err.code || ''), err && err.message);
    res.status(500).json({ error: 'Sunucu hatası. Lütfen daha sonra tekrar deneyin.' });
});

// ===== START =====
const PORT = process.env.PORT || 3001;
const HOST = process.env.LISTEN_HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : PORT;
    console.log(`🚀 Fidelio sunucusu çalışıyor: http://${HOST}:${port}`);
    console.log(`👉 Webhook: POST /api/webhook ${process.env.WEBHOOK_SECRET ? '(secret korumalı)' : '(WEBHOOK_SECRET tanımlı değil, devre dışı)'}`);
    console.log('🔐 JWT kimlik doğrulaması etkin');
});

module.exports = { app, server, io };
