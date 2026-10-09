const path = require('path');
const fs = require('fs');
const os = require('os');
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
const outcomesLib = require('./outcomes.cjs');

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
    // Engine signals carry engine + magnitude in signal_meta (see the SIGNAL ENGINE section); every signal
    // with a measurement row carries its outcome (see SIGNAL OUTCOMES). Both are extra queries that never break the list.
    return outcomes.attach(await attachSignalMeta(rows.map(toSignalDto)));
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
    // Marked before the insert: this process's relay must never send it a second time (see SIGNAL RELAY).
    rememberRelayedSignal(signal.id, now);
    await insertSignal(signal, now);
    io.emit('new_signal', signal);
    outcomes.registerQuietly({ ...signal, timeMs: now }); // forward tracking (fire and forget)
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
    await deleteSignalMeta(req.params.id);
    await outcomes.remove(req.params.id); // a removed (wrong / test) signal leaves the scorecard too
    noteSignalDeleted(req.params.id);
    io.emit('signal_deleted', { id: req.params.id });
    await recordDeleteTombstone(req.params.id); // browsers of the other processes (see SIGNAL RELAY)
    res.json({ success: true });
});

// Delete all signals (admin only)
app.delete('/api/signals', authenticateToken, requireAdmin, async (req, res) => {
    // Taken before the DELETE: signals stored after this instant survive it (the relay sends them again).
    const clearedAt = Date.now();
    const [result] = await db.query('DELETE FROM signals');
    await deleteSignalMeta(null);
    recentWebhookSignals.clear();
    noteSignalsCleared(clearedAt);
    io.emit('signals_cleared');
    await recordClearTombstone(clearedAt);
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

// ===== SIGNAL ENGINE (momentum / volume / funding, server side) =====
// The three engines run in this Node process, 24/7 and in ONE place: their signals are stored in
// `signals` (+ engine / magnitude in `signal_meta`), broadcast over socket.io and optionally sent to
// one Telegram chat. The engine core is TypeScript in engine/ (no Express / DB inside), bundled by
// `npm run build:engine` into server/build/engine.cjs.
//  - Single leader: only the process holding the MySQL named lock 'fidelio_engine' runs the engine.
//    The lock lives on a dedicated connection that is never returned to the pool; other processes
//    (a second instance, or the old process during a redeploy) stay 'standby' and retry every 60 s.
//  - engine_state holds 'settings' (global, admin-editable), 'cooldowns' (written at most every 10 s,
//    reloaded on start so that a restart does not re-announce), 'boots' (last 50 process starts) and
//    'leader' (the leader's live status, written every 5 s with the lock check: standby processes answer
//    GET /api/engine/status with it, because the host runs several processes and a browser reaches any one).
//  - Without the tables (no CREATE privilege) everything keeps working with in-memory state.

const PROCESS_STARTED_AT = Date.now();
const ENGINE_LOCK_NAME = 'fidelio_engine';
const ENGINE_LOCK_RETRY_MS = 60 * 1000;
// Hostinger's MySQL drops connections that are idle for ~20 s, so the lock connection is used every 5 s.
const ENGINE_LOCK_CHECK_MS = 5 * 1000;
const ENGINE_DB_RETRY_MS = 30 * 1000;
const ENGINE_SHARED_REFRESH_MS = 60 * 1000;
const ENGINE_COOLDOWN_WRITE_MS = 10 * 1000;
const ENGINE_BOOTS_KEEP = 50;
const ENGINE_SIGNAL_SOURCES = ['ALGO_MOMENTUM', 'ALGO_VOLUME', 'ALGO_DIVERGENCE'];
const ENGINE_KINDS = ['MOMENTUM', 'VOLUME', 'FUNDING'];
// Symbol of the market-wide aggregate records (utils/signalEngines.ts MARKET_SYMBOL): stored with price 0.
const ENGINE_MARKET_SYMBOL = 'MARKET';
const ENGINE_STREAM_KEYS = ['spotMini', 'spotHour', 'futuresMark', 'futuresMini'];
const SIGNALS_TODAY_CACHE_MS = 15 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// A standby reports the leader as running only while its heartbeat is at most 20 s old; it re-reads the
// heartbeat at most every 3 s.
const LEADER_HEARTBEAT_STALE_MS = 20 * 1000;
const LEADER_HEARTBEAT_CACHE_MS = 3 * 1000;
const LEADER_HEARTBEAT_COUNT_WAIT_MS = 3 * 1000; // the heartbeat waits at most this long for today's signal count

const parseEngineMode = (raw) => {
    const value = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase();
    if (value === '' || value === 'server') return 'server';
    if (['off', 'false', '0', 'disabled', 'none'].includes(value)) return 'off';
    console.warn(`⚠️  ENGINE_MODE="${value.slice(0, 40)}" tanınmıyor ('server' veya 'off' olmalı); 'server' kullanılıyor.`);
    return 'server';
};
const ENGINE_MODE = parseEngineMode(process.env.ENGINE_MODE);

const ENGINE_BUNDLE_PATH = path.join(__dirname, 'build', 'engine.cjs');
let engineModule = null;
try {
    engineModule = require(ENGINE_BUNDLE_PATH);
} catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && !fs.existsSync(ENGINE_BUNDLE_PATH)) {
        console.warn('⚠️  Sinyal motoru paketi yok (server/build/engine.cjs): motor devre dışı. `npm run build` veya `npm run build:engine` çalıştırın; sunucu motor olmadan çalışmaya devam ediyor.');
    } else {
        console.error('❌ Sinyal motoru paketi yüklenemedi, motor devre dışı:', err && (err.code || err.message));
    }
}

const engineLog = {
    info: (message) => console.log(message),
    warn: (message) => console.warn(message),
    error: (message) => console.error(message)
};

// The same failure (e.g. DB down) is logged at most once per interval (engine: 5 minutes).
const engineWarnedAt = new Map();
const warnThrottled = (key, intervalMs, ...args) => {
    const now = Date.now();
    if (now - (engineWarnedAt.get(key) || 0) < intervalMs) return;
    engineWarnedAt.set(key, now);
    console.warn(...args);
};
const engineWarn = (key, ...args) => warnThrottled(key, 5 * 60 * 1000, ...args);

const unrefTimer = (timer) => {
    if (timer && typeof timer.unref === 'function') timer.unref();
    return timer;
};

const sleep = (ms) => new Promise(resolve => unrefTimer(setTimeout(resolve, ms)));

// A hung query on the lock connection (silent network drop: no FIN, no error) must not keep a stale
// leader running or block re-election forever, so the lock queries race against a timer.
const ENGINE_LOCK_QUERY_TIMEOUT_MS = 10 * 1000;
const withTimeout = (promise, ms, label) => {
    let timer = null;
    const timeout = new Promise((resolve, reject) => {
        timer = unrefTimer(setTimeout(() => {
            const err = new Error(`${label}: ${Math.round(ms / 1000)} sn içinde yanıt yok`);
            err.code = 'ENGINE_TIMEOUT';
            reject(err);
        }, ms));
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const engineTelegram = engineModule
    ? engineModule.createTelegramNotifier({
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID,
        minPriority: process.env.TELEGRAM_MIN_PRIORITY,
        maxPerMinute: 20,
        log: engineLog
    })
    : null;
if (engineTelegram && engineTelegram.enabled) {
    console.log(`📨 Motor sinyalleri Telegram'a sunucudan gönderilecek (en düşük öncelik: ${engineTelegram.minPriority}).`);
}

const engineHost = {
    role: ENGINE_MODE === 'server' && engineModule ? 'standby' : 'off', // 'leader' | 'standby' | 'off'
    engine: null,
    lockConn: null,
    stateTable: null,  // engine_state usable: true / false (in-memory only) / null (not checked yet)
    metaTable: null,   // signal_meta usable: same
    settings: engineModule ? engineModule.sanitizeSignalSettings(null) : null,
    cooldowns: null,   // latest cooldown stamps (also kept in memory for in-memory mode)
    boots: [PROCESS_STARTED_AT],
    pendingCooldowns: null,
    cooldownTimer: null,
    lastCooldownWriteAt: 0,
    lockTimer: null,
    lockCheckTimer: null,
    sharedTimer: null,
    shuttingDown: false,
    acquiring: false,
    settingsSeq: 0,    // bumped by every settings change of this process (PUT); see refreshSharedState
    standbyLogged: false,
    today: { day: 0, count: 0 },          // engine signals published by THIS process since 00:00 UTC
    todayCache: { day: 0, at: 0, value: 0 }, // DB count (all processes), cached briefly
    todayCounting: false,    // a COUNT for todayCache is in flight
    heartbeatAt: 0,          // last heartbeat this process stored as leader
    heartbeatPromise: null,  // heartbeat write in flight (never two at once)
    leaderBeat: { value: null, at: 0, pending: null } // standby: the leader's heartbeat, read at most every 3 s
};

// --- engine_state / signal_meta ---
const ENGINE_TABLES = {
    engine_state: {
        create: 'CREATE TABLE IF NOT EXISTS engine_state (k VARCHAR(64) PRIMARY KEY, v LONGTEXT, updated_at BIGINT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
        probe: 'SELECT k FROM engine_state LIMIT 1',
        without: 'motor durumu (ayarlar, bekleme süreleri, başlangıçlar) yalnızca bellekte tutulacak'
    },
    signal_meta: {
        create: 'CREATE TABLE IF NOT EXISTS signal_meta (signal_id VARCHAR(50) PRIMARY KEY, engine VARCHAR(16), magnitude TEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
        probe: 'SELECT signal_id FROM signal_meta LIMIT 1',
        without: 'motor sinyallerinin motor/ölçüm bilgisi saklanmayacak'
    },
    signal_outcomes: {
        create: outcomesLib.CREATE_TABLE_SQL,
        probe: outcomesLib.PROBE_TABLE_SQL,
        without: 'sinyal sonuçları ölçülmeyecek, sinyal karnesi boş kalacak'
    }
};

// ===== SIGNAL OUTCOMES (server/outcomes.cjs) =====
// Every stored signal except the MARKET aggregates gets a signal_outcomes row right after it is stored (engine,
// webhook and manual paths, in any process). Only the engine leader measures the due horizons (15m / 1h / 4h /
// 24h) from Binance klines every 60 s (at most 40 Binance requests per minute) and emits 'signal_outcome' to its
// own browsers; on its first pass it backfills the signals of the last 7 days that have no row yet.
// GET /api/signals carries each signal's outcome, GET /api/scorecard the per-strategy summary.
const outcomes = outcomesLib.createOutcomeTracker({
    db,
    fetch: (...args) => globalThis.fetch(...args),
    now: () => Date.now(),
    isLeader: () => engineHost.role === 'leader' && !engineHost.shuttingDown,
    hasTimeMs: () => hasSignalsTimeMs(),
    emit: (event, payload) => io.emit(event, payload),
    log: engineLog
});

// Additive only: CREATE TABLE IF NOT EXISTS, never ALTER / DROP. Without the CREATE privilege a table
// that already exists (created from server/schema.sql) is still used.
const ensureEngineTable = async (table) => {
    const def = ENGINE_TABLES[table];
    try {
        await db.query(def.create);
        return true;
    } catch (createErr) {
        try {
            await db.query(def.probe);
            return true;
        } catch {
            console.warn(`⚠️  [engine] ${table} tablosu oluşturulamadı (${createErr.code || createErr.message}); ${def.without}.`);
            return false;
        }
    }
};

const readEngineState = async (key) => {
    const [rows] = await db.query('SELECT v FROM engine_state WHERE k = ? LIMIT 1', [key]);
    const raw = rows && rows[0] ? rows[0].v : undefined;
    if (typeof raw !== 'string') return undefined;
    try {
        return JSON.parse(raw);
    } catch {
        return undefined;
    }
};

const writeEngineState = async (key, value) => {
    await db.query(
        'INSERT INTO engine_state (k, v, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v), updated_at = VALUES(updated_at)',
        [key, JSON.stringify(value), Date.now()]
    );
};

const cleanBoots = (raw) => (Array.isArray(raw)
    ? raw.filter(t => typeof t === 'number' && Number.isFinite(t) && t > 0)
    : []);

const withOwnBoot = (boots) => {
    const list = boots.includes(PROCESS_STARTED_AT) ? boots.slice() : [...boots, PROCESS_STARTED_AT];
    return list.sort((a, b) => a - b).slice(-ENGINE_BOOTS_KEEP);
};

// Boot history: lets us see whether the host keeps the process alive (every restart adds an entry).
const recordBoot = async () => {
    if (!engineHost.stateTable) return;
    try {
        engineHost.boots = withOwnBoot(cleanBoots(await readEngineState('boots')));
        await writeEngineState('boots', engineHost.boots);
        const lastDay = engineHost.boots.filter(t => t >= PROCESS_STARTED_AT - DAY_MS).length;
        console.log(`[engine] Süreç başlangıcı kaydedildi (son 24 saatte ${lastDay} başlangıç, kayıtlı ${engineHost.boots.length}).`);
    } catch (err) {
        engineWarn('boots', '[engine] Süreç başlangıcı kaydedilemedi:', err.code || err.message);
    }
};

const applyEngineSettings = (settings, { local = false } = {}) => {
    if (local) engineHost.settingsSeq++;
    engineHost.settings = settings;
    if (engineHost.role === 'leader' && engineHost.engine) engineHost.engine.updateSettings(settings);
};

// Settings may be changed through another process (PUT on the standby instance): re-read them every
// minute. Also refreshes the boot list. Returns the stored cooldowns when asked for them.
const refreshSharedState = async ({ withCooldowns = false } = {}) => {
    if (!engineHost.stateTable) return undefined;
    // A PUT handled by this process while the read was in flight wins over the (older) row just read.
    const seq = engineHost.settingsSeq;
    try {
        const stored = await readEngineState('settings');
        if (stored !== undefined && engineModule && seq === engineHost.settingsSeq) {
            const settings = engineModule.sanitizeSignalSettings(stored);
            if (JSON.stringify(settings) !== JSON.stringify(engineHost.settings)) applyEngineSettings(settings);
        }
        const boots = cleanBoots(await readEngineState('boots'));
        if (boots.length > 0) engineHost.boots = withOwnBoot(boots);
        return withCooldowns ? await readEngineState('cooldowns') : undefined;
    } catch (err) {
        engineWarn('shared', '[engine] Motor durumu veritabanından okunamadı:', err.code || err.message);
        return undefined;
    }
};

// --- Cooldown persistence (at most one write per 10 s; final flush on shutdown) ---
const flushCooldowns = async () => {
    if (engineHost.cooldownTimer) {
        clearTimeout(engineHost.cooldownTimer);
        engineHost.cooldownTimer = null;
    }
    const value = engineHost.pendingCooldowns;
    if (!value || !engineHost.stateTable) return;
    engineHost.pendingCooldowns = null;
    engineHost.lastCooldownWriteAt = Date.now();
    try {
        await writeEngineState('cooldowns', value);
    } catch (err) {
        engineWarn('cooldowns', '[engine] Bekleme süreleri kaydedilemedi:', err.code || err.message);
        if (!engineHost.pendingCooldowns) engineHost.pendingCooldowns = value;
        if (engineHost.role === 'leader' && !engineHost.shuttingDown) scheduleCooldownWrite(engineHost.pendingCooldowns);
    }
};

// Newest stamp per key of two cooldown sets (either may be missing or malformed).
const mergeCooldowns = (a, b) => {
    const now = Date.now();
    const x = engineModule.sanitizeEngineCooldowns(a, now);
    const y = engineModule.sanitizeEngineCooldowns(b, now);
    for (const kind of ['momentum', 'volume', 'funding']) {
        for (const [key, at] of Object.entries(y[kind])) {
            if (!(x[kind][key] >= at)) x[kind][key] = at;
        }
    }
    return x;
};

const scheduleCooldownWrite = (cooldowns) => {
    engineHost.cooldowns = cooldowns;
    if (!engineHost.stateTable) return;
    engineHost.pendingCooldowns = cooldowns;
    if (engineHost.cooldownTimer) return;
    const wait = Math.max(0, engineHost.lastCooldownWriteAt + ENGINE_COOLDOWN_WRITE_MS - Date.now());
    engineHost.cooldownTimer = unrefTimer(setTimeout(() => {
        engineHost.cooldownTimer = null;
        flushCooldowns().catch(() => { /* logged inside */ });
    }, wait));
};

// --- Engine signals -> signals + signal_meta -> socket.io -> Telegram ---
const cleanMagnitude = (raw) => {
    if (!isPlainObject(raw)) return null;
    const value = Number(raw.value);
    if (!Number.isFinite(value) || typeof raw.text !== 'string' || typeof raw.caption !== 'string') return null;
    return { value, text: raw.text.slice(0, 40), caption: raw.caption.slice(0, 120) };
};

const parseStoredMagnitude = (raw) => {
    if (typeof raw !== 'string' || raw === '') return null;
    try {
        return cleanMagnitude(JSON.parse(raw));
    } catch {
        return null;
    }
};

const utcDayStart = (t) => t - (((t % DAY_MS) + DAY_MS) % DAY_MS);

const countEngineSignal = (at) => {
    const day = utcDayStart(at);
    if (engineHost.today.day !== day) engineHost.today = { day, count: 0 };
    engineHost.today.count++;
    engineHost.todayCache.at = 0; // the DB count is stale now
};

// Same rule as webhook / manual signals: stored first, broadcast only after the row is safely stored.
// signal_meta is written BEFORE the signals row: the relay of another process (and GET /api/signals) must
// never see the row without its engine / magnitude. A meta row left behind by a failed insert is harmless.
const publishEngineSignal = async (draft) => {
    if (!isPlainObject(draft) || !ENGINE_KINDS.includes(draft.engine) || !ENGINE_SIGNAL_SOURCES.includes(draft.source)) {
        engineWarn('bad-signal', '[engine] Geçersiz motor sinyali atlandı.');
        return null;
    }
    // The burst guard's market-wide aggregates (symbol MARKET, strategy Market_Wide_*) are not a tradable
    // pair and carry price 0; every other engine record needs a positive price.
    const marketAggregate = draft.symbol === ENGINE_MARKET_SYMBOL && typeof draft.strategy === 'string' && draft.strategy.startsWith('Market_Wide_');
    const price = Number(draft.price);
    if (!Number.isFinite(price) || (marketAggregate ? price < 0 : price <= 0) || price >= MAX_PRICE) {
        engineWarn('bad-price', `[engine] Geçersiz fiyatlı motor sinyali atlandı (${String(draft.symbol).slice(0, 20)}).`);
        return null;
    }
    const at = typeof draft.at === 'number' && Number.isFinite(draft.at) ? draft.at : Date.now();
    const signal = {
        id: crypto.randomUUID(),
        strategy: String(draft.strategy || '').slice(0, 100),
        symbol: String(draft.symbol || '').slice(0, 20),
        side: String(draft.side || 'NEUTRAL').slice(0, 10),
        price: Number(price.toFixed(8)), // DECIMAL(20, 8): broadcast exactly what GET /api/signals returns
        time: new Date(at).toISOString(),
        note: typeof draft.note === 'string' ? draft.note : '',
        source: draft.source,
        confidence: null // engines never write a confidence; the measured size is in magnitude
    };
    rememberRelayedSignal(signal.id, at); // this process emits it itself: its relay must skip it

    const magnitude = cleanMagnitude(draft.magnitude);
    let metaStored = false;
    if (engineHost.metaTable !== false) {
        try {
            await db.query(
                'INSERT INTO signal_meta (signal_id, engine, magnitude) VALUES (?, ?, ?)',
                [signal.id, draft.engine, magnitude ? JSON.stringify(magnitude) : null]
            );
            metaStored = true;
        } catch (err) {
            engineWarn('meta-insert', '[engine] Sinyalin motor/ölçüm bilgisi kaydedilemedi:', err.code || err.message);
        }
    }
    try {
        await insertSignal(signal, at);
    } catch (err) {
        if (metaStored) await deleteSignalMeta(signal.id);
        throw err;
    }

    const dto = { ...toSignalDto(signal), engine: draft.engine };
    if (magnitude) dto.magnitude = magnitude;
    io.emit('new_signal', dto);
    outcomes.registerQuietly({ ...signal, engine: draft.engine, timeMs: at }); // forward tracking (MARKET: none)
    countEngineSignal(at);
    console.log(`[engine] Sinyal: ${dto.symbol} ${dto.side} ${dto.strategy}${magnitude ? ` (${magnitude.text})` : ''}`);
    if (engineTelegram) {
        engineTelegram.notify(dto).catch(err => engineWarn('telegram', '[telegram] Motor sinyali gönderilemedi:', err && err.name));
    }
    return dto;
};

const handleEngineSignals = async (signals) => {
    if (!Array.isArray(signals)) return [];
    const published = [];
    for (const draft of signals) {
        try {
            const dto = await publishEngineSignal(draft);
            if (dto) published.push(dto);
        } catch (err) {
            console.error('[engine] Sinyal kaydedilemedi, yayımlanmadı:', err && (err.code || err.message));
        }
    }
    return published;
};

// GET /api/signals: engine / magnitude of engine signals come from signal_meta (second query, so a
// missing table never breaks the signal list).
const attachSignalMeta = async (signals) => {
    if (engineHost.metaTable === false) return signals;
    const ids = signals.filter(s => ENGINE_SIGNAL_SOURCES.includes(s.source)).map(s => s.id);
    if (ids.length === 0) return signals;
    try {
        const [rows] = await db.query(
            `SELECT signal_id, engine, magnitude FROM signal_meta WHERE signal_id IN (${ids.map(() => '?').join(', ')})`,
            ids
        );
        const byId = new Map((rows || []).map(row => [row.signal_id, row]));
        for (const signal of signals) {
            const meta = byId.get(signal.id);
            if (!meta) continue;
            if (ENGINE_KINDS.includes(meta.engine)) signal.engine = meta.engine;
            const magnitude = parseStoredMagnitude(meta.magnitude);
            if (magnitude) signal.magnitude = magnitude;
        }
    } catch (err) {
        engineWarn('meta-read', '[engine] Sinyallerin motor/ölçüm bilgisi okunamadı:', err.code || err.message);
    }
    return signals;
};

// Best effort: a leftover signal_meta row is harmless (it is only ever read by signal id).
const deleteSignalMeta = async (id) => {
    if (engineHost.metaTable === false) return;
    try {
        if (id === null) await db.query('DELETE FROM signal_meta');
        else await db.query('DELETE FROM signal_meta WHERE signal_id = ?', [id]);
    } catch (err) {
        engineWarn('meta-delete', '[engine] signal_meta temizlenemedi:', err.code || err.message);
    }
};

// The last known count (DB count of today, or this process's own count): never waits for the DB.
const knownSignalsToday = () => {
    const day = utcDayStart(Date.now());
    const local = engineHost.today.day === day ? engineHost.today.count : 0;
    const cache = engineHost.todayCache;
    return Math.max(cache.day === day ? cache.value : 0, local);
};

// Engine signals since 00:00 UTC: counted in the DB (covers every process and restart), cached for 15 s;
// this process's own count is the fallback. One COUNT at a time: while one is in flight (or hung), other
// callers get the last known count at once instead of queueing another query.
const countSignalsToday = async () => {
    const now = Date.now();
    const day = utcDayStart(now);
    const local = engineHost.today.day === day ? engineHost.today.count : 0;
    const cache = engineHost.todayCache;
    if (cache.day === day && now - cache.at < SIGNALS_TODAY_CACHE_MS) return Math.max(cache.value, local);
    if (engineHost.todayCounting) return knownSignalsToday();
    engineHost.todayCounting = true;
    let value = local;
    try {
        const useTimeMs = await hasSignalsTimeMs();
        const [rows] = await db.query(
            `SELECT COUNT(*) AS total FROM signals WHERE source IN (?, ?, ?) AND ${useTimeMs ? 'time_ms' : 'time'} >= ?`,
            [...ENGINE_SIGNAL_SOURCES, useTimeMs ? day : new Date(day).toISOString()]
        );
        value = Number(rows && rows[0] && rows[0].total) || 0;
    } catch (err) {
        engineWarn('today', '[engine] Bugünkü sinyal sayısı okunamadı:', err.code || err.message);
    } finally {
        engineHost.todayCounting = false;
    }
    engineHost.todayCache = { day, at: now, value };
    return Math.max(value, local);
};

// --- Leader lock (MySQL named lock on a dedicated connection) ---
// Never return a connection that holds the lock to the pool: the lock would stay with whoever uses it next.
const dropConnection = (conn) => {
    if (!conn) return;
    try {
        if (typeof conn.destroy === 'function') conn.destroy(); // closing the connection frees its locks
        else if (typeof conn.release === 'function') conn.release();
    } catch { /* already gone */ }
};

const acquireEngineLock = async () => {
    // Gave up waiting (timeout): a connection / lock that arrives later is dropped, never kept.
    let abandoned = false;
    const attempt = (async () => {
        const conn = await db.getConnection();
        if (abandoned) {
            dropConnection(conn);
            return null;
        }
        let acquired = false;
        try {
            const [rows] = await conn.query('SELECT GET_LOCK(?, 0) AS acquired', [ENGINE_LOCK_NAME]);
            acquired = !!(rows && rows[0]) && Number(rows[0].acquired) === 1;
        } catch (err) {
            dropConnection(conn);
            throw err;
        }
        if (abandoned) {
            dropConnection(conn); // closing the connection frees a lock it may have just taken
            return null;
        }
        return { conn, acquired };
    })();
    let result;
    try {
        result = await withTimeout(attempt, ENGINE_LOCK_QUERY_TIMEOUT_MS, 'kilit sorgusu');
    } catch (err) {
        abandoned = true;
        attempt.catch(() => { /* reported through the timeout */ });
        throw err;
    }
    if (!result) return false;
    const { conn, acquired } = result;
    if (!acquired) {
        conn.release(); // holds nothing
        return false;
    }
    engineHost.lockConn = conn;
    // Ask the server to keep this session open longer (may be refused on shared hosting; the 5 s check still keeps it busy).
    conn.query('SET SESSION wait_timeout = 3600').catch(() => { /* not allowed: rely on the frequent lock check */ });
    if (typeof conn.on === 'function') {
        conn.on('error', () => {
            if (engineHost.lockConn !== conn) return;
            // The lock died with its connection: check (and step down) right away.
            scheduleLockCheck(0);
        });
    }
    return true;
};

const releaseEngineLock = async () => {
    const conn = engineHost.lockConn;
    engineHost.lockConn = null;
    if (!conn) return;
    try {
        await withTimeout(conn.query('SELECT RELEASE_LOCK(?) AS released', [ENGINE_LOCK_NAME]), 2000, 'kilit bırakma');
    } catch { /* closing the connection below releases it as well */ }
    dropConnection(conn);
};

const scheduleLockRetry = (ms) => {
    if (engineHost.lockTimer) clearTimeout(engineHost.lockTimer);
    engineHost.lockTimer = unrefTimer(setTimeout(() => {
        engineHost.lockTimer = null;
        tryBecomeLeader().catch(err => console.error('[engine] Motor kilidi denemesi başarısız:', err && (err.code || err.message)));
    }, ms));
};

const scheduleLockCheck = (ms = ENGINE_LOCK_CHECK_MS) => {
    if (engineHost.lockCheckTimer) clearTimeout(engineHost.lockCheckTimer);
    engineHost.lockCheckTimer = unrefTimer(setTimeout(() => {
        engineHost.lockCheckTimer = null;
        checkEngineLock().catch(err => console.error('[engine] Kilit kontrolü başarısız:', err && (err.code || err.message)));
    }, ms));
};

// Lost leadership: stop at once. Pending cooldowns are dropped, the new leader may already write its own.
const stepDown = () => {
    outcomes.stopResolver();
    if (engineHost.lockCheckTimer) clearTimeout(engineHost.lockCheckTimer);
    engineHost.lockCheckTimer = null;
    if (engineHost.cooldownTimer) clearTimeout(engineHost.cooldownTimer);
    engineHost.cooldownTimer = null;
    engineHost.pendingCooldowns = null;
    if (engineHost.engine) {
        try {
            engineHost.engine.stop();
        } catch (err) {
            console.error('[engine] Motor durdurulamadı:', err && err.message);
        }
    }
    const conn = engineHost.lockConn;
    engineHost.lockConn = null;
    dropConnection(conn);
    engineHost.role = 'standby';
};

// Every 5 s: the query keeps the dedicated connection alive (idle cut-off) and proves we still hold the lock.
// While the lock is held, the leader also stores its heartbeat (engine_state 'leader', one small UPSERT).
const checkEngineLock = async () => {
    if (engineHost.role !== 'leader' || engineHost.shuttingDown) return;
    const conn = engineHost.lockConn;
    let held = false;
    let reason = 'kilit bağlantısı yok';
    if (conn) {
        try {
            const [rows] = await withTimeout(
                conn.query('SELECT IS_USED_LOCK(?) AS holder, CONNECTION_ID() AS me', [ENGINE_LOCK_NAME]),
                ENGINE_LOCK_QUERY_TIMEOUT_MS,
                'kilit kontrolü'
            );
            const row = rows && rows[0];
            held = !!row && row.holder !== null && row.holder !== undefined && String(row.holder) === String(row.me);
            if (!held) reason = 'kilit artık bu bağlantıda değil';
        } catch (err) {
            reason = `kilit bağlantısı koptu: ${err.code === 'ENGINE_TIMEOUT' ? err.message : (err.code || err.message)}`;
        }
    }
    if (engineHost.role !== 'leader' || engineHost.shuttingDown || engineHost.lockConn !== conn) return;
    if (held) {
        sendLeaderHeartbeat();
        scheduleLockCheck();
        return;
    }
    console.warn(`[engine] Motor kilidi kaybedildi (${reason}); motor durduruldu, kilit yeniden denenecek.`);
    stepDown();
    scheduleLockRetry(5000);
};

const becomeLeader = async () => {
    engineHost.role = 'leader';
    engineHost.standbyLogged = false;
    // Latest settings and the cooldown stamps of the previous run (so a restart does not re-announce).
    // Stored and in-memory stamps are merged: after a short lock loss this process may hold newer stamps
    // than the last (throttled) write, and the stored ones may come from another leader.
    const stored = await withTimeout(refreshSharedState({ withCooldowns: true }), ENGINE_LOCK_QUERY_TIMEOUT_MS, 'motor durumu')
        .catch(err => {
            engineWarn('shared', '[engine] Motor durumu veritabanından okunamadı:', err.message);
            return undefined;
        });
    if (engineHost.role !== 'leader' || engineHost.shuttingDown) return;
    const cooldowns = mergeCooldowns(stored, engineHost.cooldowns);
    let engine;
    try {
        engine = engineModule.createEngine({
            settings: engineHost.settings,
            cooldowns,
            onSignals: handleEngineSignals,
            onStateChange: scheduleCooldownWrite,
            log: engineLog
        });
        engine.start();
    } catch (err) {
        console.error('[engine] Motor başlatılamadı:', err && err.message);
        if (engine) {
            try { engine.stop(); } catch { /* ignore */ }
        }
        await releaseEngineLock();
        engineHost.role = 'standby';
        scheduleLockRetry(ENGINE_LOCK_RETRY_MS);
        return;
    }
    engineHost.engine = engine;
    engineHost.cooldowns = engine.getCooldowns();
    console.log('[engine] Motor kilidi alındı: sinyal motoru bu süreçte çalışıyor.');
    sendLeaderHeartbeat(); // standby processes see the new leader at once, not only after the first check
    scheduleLockCheck();
    outcomes.startResolver(); // signal outcomes are measured by the leader only
};

const tryBecomeLeader = async () => {
    if (engineHost.shuttingDown || engineHost.role === 'leader' || engineHost.acquiring || !engineModule || ENGINE_MODE !== 'server') return;
    // One attempt at a time: a second, overlapping attempt would see the lock held by the first and
    // overwrite its 'leader' role with 'standby'.
    engineHost.acquiring = true;
    let acquired = false;
    let failed = false;
    try {
        try {
            acquired = await acquireEngineLock();
        } catch (err) {
            failed = true;
            const reason = err.code === 'ENGINE_TIMEOUT' ? err.message : (err.code || err.message);
            engineWarn('lock', `[engine] Motor kilidi denenemedi (${reason}); ${ENGINE_LOCK_RETRY_MS / 1000} sn sonra yeniden denenecek.`);
        }
        if (engineHost.shuttingDown) {
            if (acquired) await releaseEngineLock();
            return;
        }
        if (acquired) {
            await becomeLeader();
            return;
        }
    } finally {
        engineHost.acquiring = false;
    }
    engineHost.role = 'standby';
    if (!failed && !engineHost.standbyLogged) {
        engineHost.standbyLogged = true;
        console.log(`[engine] Motor kilidi başka bir süreçte: bu süreç beklemede (${ENGINE_LOCK_RETRY_MS / 1000} sn'de bir yeniden denenecek).`);
    }
    scheduleLockRetry(ENGINE_LOCK_RETRY_MS);
};

// Started once the HTTP server listens; never blocks or breaks the API.
const startEngineHost = async () => {
    for (let attempt = 1; ; attempt++) {
        if (engineHost.shuttingDown) return;
        try {
            await db.query('SELECT 1');
            break;
        } catch (err) {
            if (attempt === 1 || attempt % 10 === 0) {
                console.warn(`[engine] Veritabanına ulaşılamıyor (${err.code || err.message}); ${ENGINE_DB_RETRY_MS / 1000} sn sonra yeniden denenecek.`);
            }
            await sleep(ENGINE_DB_RETRY_MS);
        }
    }
    engineHost.stateTable = await ensureEngineTable('engine_state');
    engineHost.metaTable = await ensureEngineTable('signal_meta');
    outcomes.setTable(await ensureEngineTable('signal_outcomes'));
    await recordBoot();
    await refreshSharedState();
    engineHost.sharedTimer = unrefTimer(setInterval(() => {
        refreshSharedState().catch(() => { /* logged inside */ });
    }, ENGINE_SHARED_REFRESH_MS));

    if (ENGINE_MODE !== 'server') {
        console.log('[engine] ENGINE_MODE=off: sinyal motoru bu süreçte çalışmıyor.');
        return;
    }
    if (!engineModule) return;
    await tryBecomeLeader();
};

// SIGTERM / SIGINT: stop the signal relay, final cooldown write, stop the engine, mark the heartbeat as
// stopped (standby processes report it at once instead of after 20 s), release the lock (a standby process
// takes it at its next attempt, within 60 s).
const shutdownEngineHost = async () => {
    if (engineHost.shuttingDown) return;
    engineHost.shuttingDown = true;
    stopSignalRelay();
    outcomes.stopResolver();
    for (const key of ['lockTimer', 'lockCheckTimer']) {
        if (engineHost[key]) clearTimeout(engineHost[key]);
        engineHost[key] = null;
    }
    if (engineHost.sharedTimer) clearInterval(engineHost.sharedTimer);
    engineHost.sharedTimer = null;
    const wasLeader = engineHost.role === 'leader';
    if (engineHost.engine) {
        try {
            engineHost.engine.stop();
        } catch { /* ignore */ }
        if (wasLeader) engineHost.pendingCooldowns = engineHost.engine.getCooldowns();
    }
    if (wasLeader) await flushCooldowns();
    if (wasLeader) await markLeaderStopped();
    await releaseEngineLock();
    engineHost.role = 'off';
};

const zeroEngineStat = () => ({ matching: 0, universe: 0 });
const idleEngineStats = () => ({ momentum: zeroEngineStat(), volume: zeroEngineStat(), funding: zeroEngineStat(), updatedAt: 0 });

// This process's own engine view: the leader answers GET /api/engine/status with it and stores it as its heartbeat.
const localEngineView = () => {
    const snap = engineHost.engine ? engineHost.engine.getStatus() : null;
    const running = engineHost.role === 'leader' && !!snap && snap.running;
    const streams = {};
    for (const key of ENGINE_STREAM_KEYS) streams[key] = running && snap.streams[key] ? snap.streams[key] : 'down';
    return {
        running,
        startedAt: running ? snap.startedAt : null,
        uptimeSec: Math.floor(process.uptime()),
        processStartedAt: PROCESS_STARTED_AT,
        streams,
        lastScan: snap ? { ...snap.lastScan } : { momentum: null, volume: null, funding: null },
        stats: running ? snap.stats : idleEngineStats(),
        activeFunding: running
            ? snap.activeFunding.map(entry => ({ symbol: entry.symbol, f8: entry.f8Pct / 100, since: entry.since }))
            : [],
        telegram: { server: !!(engineTelegram && engineTelegram.enabled) }
    };
};

// --- Leader heartbeat (engine_state 'leader') ---
// { processStartedAt, pid, hostname, heartbeatAt, running, startedAt, uptimeSec, streams, lastScan, stats,
//   activeFunding, telegram, signalsToday } (+ stoppedAt after a graceful shutdown). pid / hostname are for
// diagnostics in the table only; the API never returns them.
const buildLeaderHeartbeat = (signalsToday) => ({
    ...localEngineView(),
    pid: process.pid,
    hostname: os.hostname(),
    heartbeatAt: Date.now(),
    signalsToday
});

// Fire and forget, at most one write in flight; a failure is logged once per minute (standby processes then
// report the leader as stale after 20 s, which is the truth seen from outside).
const sendLeaderHeartbeat = () => {
    if (engineHost.role !== 'leader' || engineHost.shuttingDown || engineHost.stateTable !== true || engineHost.heartbeatPromise) return;
    engineHost.heartbeatPromise = (async () => {
        try {
            // DB count (cached 15 s); a slow or hung COUNT never holds the heartbeat back
            const signalsToday = await withTimeout(countSignalsToday(), LEADER_HEARTBEAT_COUNT_WAIT_MS, 'günlük sinyal sayısı')
                .catch(() => knownSignalsToday());
            if (engineHost.role !== 'leader' || engineHost.shuttingDown) return;
            const heartbeat = buildLeaderHeartbeat(signalsToday);
            await withTimeout(writeEngineState('leader', heartbeat), ENGINE_LOCK_QUERY_TIMEOUT_MS, 'kalp atışı');
            engineHost.heartbeatAt = heartbeat.heartbeatAt;
        } catch (err) {
            warnThrottled('heartbeat', 60 * 1000, '[engine] Lider kalp atışı kaydedilemedi:', err.code || err.message);
        } finally {
            engineHost.heartbeatPromise = null;
        }
    })();
};

// Graceful shutdown of the leader: still holding the lock, so no other leader can have written meanwhile.
// A heartbeat write in flight is waited for briefly (it must not land after stoppedAt); exitGracefully ends the
// process 5 s after SIGTERM, so a hung one is not waited for (RELEASE_LOCK must still run).
const markLeaderStopped = async () => {
    if (engineHost.stateTable !== true) return;
    if (engineHost.heartbeatPromise) await withTimeout(engineHost.heartbeatPromise, 1000, 'kalp atışı').catch(() => { /* hung */ });
    try {
        const heartbeat = { ...buildLeaderHeartbeat(null), stoppedAt: Date.now() };
        await withTimeout(writeEngineState('leader', heartbeat), 2000, 'kalp atışı');
    } catch { /* the heartbeat turns stale after 20 s anyway */ }
};

const finiteOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// The stored heartbeat, defensively reshaped to the status fields (null when missing / malformed).
const parseLeaderHeartbeat = (raw) => {
    if (!isPlainObject(raw)) return null;
    const heartbeatAt = finiteOrNull(raw.heartbeatAt);
    if (heartbeatAt === null || heartbeatAt <= 0) return null;
    const rawStreams = isPlainObject(raw.streams) ? raw.streams : {};
    const streams = {};
    for (const key of ENGINE_STREAM_KEYS) streams[key] = ['connected', 'connecting'].includes(rawStreams[key]) ? rawStreams[key] : 'down';
    const rawScan = isPlainObject(raw.lastScan) ? raw.lastScan : {};
    const rawStats = isPlainObject(raw.stats) ? raw.stats : {};
    const stat = (s) => (isPlainObject(s)
        ? { matching: finiteOrNull(s.matching) || 0, universe: finiteOrNull(s.universe) || 0 }
        : zeroEngineStat());
    return {
        heartbeatAt,
        stoppedAt: finiteOrNull(raw.stoppedAt),
        running: raw.running === true,
        startedAt: finiteOrNull(raw.startedAt),
        uptimeSec: Math.max(0, finiteOrNull(raw.uptimeSec) || 0),
        processStartedAt: finiteOrNull(raw.processStartedAt) || 0,
        streams,
        lastScan: { momentum: finiteOrNull(rawScan.momentum), volume: finiteOrNull(rawScan.volume), funding: finiteOrNull(rawScan.funding) },
        stats: { momentum: stat(rawStats.momentum), volume: stat(rawStats.volume), funding: stat(rawStats.funding), updatedAt: finiteOrNull(rawStats.updatedAt) || 0 },
        activeFunding: Array.isArray(raw.activeFunding)
            ? raw.activeFunding.filter(e => isPlainObject(e) && typeof e.symbol === 'string').slice(0, 500)
                .map(e => ({ symbol: e.symbol, f8: finiteOrNull(e.f8), since: finiteOrNull(e.since) }))
            : [],
        telegram: { server: isPlainObject(raw.telegram) && raw.telegram.server === true },
        signalsToday: finiteOrNull(raw.signalsToday)
    };
};

// Standby: the leader's heartbeat, read at most every 3 s (concurrent requests share one read). A failed read
// keeps the previous value, which turns stale on its own.
const readLeaderHeartbeat = async () => {
    if (engineHost.stateTable !== true) return null;
    const cache = engineHost.leaderBeat;
    if (cache.at > 0 && Date.now() - cache.at <= LEADER_HEARTBEAT_CACHE_MS) return cache.value;
    if (!cache.pending) {
        cache.pending = withTimeout(readEngineState('leader'), ENGINE_LOCK_QUERY_TIMEOUT_MS, 'lider durumu')
            .then((raw) => {
                cache.value = parseLeaderHeartbeat(raw);
                cache.at = Date.now();
            })
            .catch(err => warnThrottled('leader-read', 60 * 1000, '[engine] Lider süreç durumu okunamadı:', err.code || err.message))
            .finally(() => { cache.pending = null; });
    }
    await cache.pending;
    return cache.value;
};

// Leader: its own memory. Standby: the leader's heartbeat (role 'leader' while it is at most 20 s old; else
// 'standby' + running false + leaderStale). Same shape for both, plus servedBy / leaderHeartbeatAt / leaderStale.
const buildEngineStatus = async () => {
    const own = localEngineView();
    const servedBy = engineHost.role; // taken before any await: the role may change during an election
    let view = own;
    let role = servedBy;
    let signalsToday = null;
    let leaderHeartbeatAt = null;
    let leaderStale = false;
    if (servedBy === 'leader') {
        leaderHeartbeatAt = engineHost.heartbeatAt || null;
    } else if (servedBy === 'standby') {
        const beat = await readLeaderHeartbeat();
        const now = Date.now();
        const fresh = !!beat && beat.stoppedAt === null && now - beat.heartbeatAt <= LEADER_HEARTBEAT_STALE_MS;
        leaderHeartbeatAt = beat ? beat.heartbeatAt : null;
        leaderStale = !fresh;
        if (fresh) {
            role = 'leader';
            view = {
                ...beat,
                startedAt: beat.running ? beat.startedAt : null,
                uptimeSec: beat.uptimeSec + Math.max(0, Math.floor((now - beat.heartbeatAt) / 1000))
            };
            if (beat.signalsToday !== null && utcDayStart(beat.heartbeatAt) === utcDayStart(now)) signalsToday = beat.signalsToday;
        } else if (beat) {
            view = { ...own, lastScan: beat.lastScan }; // when the leader last scanned
        }
    }
    const running = view.running;
    return {
        mode: ENGINE_MODE,
        running,
        role,
        startedAt: running ? view.startedAt : null,
        uptimeSec: view.uptimeSec,
        processStartedAt: view.processStartedAt,
        boots: engineHost.boots.slice(-ENGINE_BOOTS_KEEP),
        streams: running ? view.streams : own.streams,
        lastScan: view.lastScan,
        stats: running ? view.stats : idleEngineStats(),
        settings: engineHost.settings,
        activeFunding: running ? view.activeFunding : [],
        telegram: view.telegram,
        signalsToday: signalsToday !== null ? signalsToday : await countSignalsToday(),
        servedBy,
        leaderHeartbeatAt,
        leaderStale
    };
};

app.get('/api/engine/status', authenticateToken, async (req, res) => {
    res.json(await buildEngineStatus());
});

// Global settings for everyone (admin only). Missing fields keep their current value; everything is
// clamped by sanitizeSignalSettings. A changed threshold re-seeds that engine silently (no burst).
app.put('/api/engine/settings', authenticateToken, requireAdmin, async (req, res) => {
    if (!engineModule) {
        return res.status(503).json({ error: 'Sinyal motoru bu sunucuda yüklü değil (server/build/engine.cjs yok).' });
    }
    const body = req.body;
    if (!isPlainObject(body)) {
        return res.status(400).json({ error: 'Geçersiz istek gövdesi: ayar nesnesi bekleniyor.' });
    }
    if (body.version !== undefined && body.version !== engineModule.SIGNAL_SETTINGS_VERSION) {
        return res.status(400).json({ error: `Desteklenmeyen ayar sürümü (version: ${engineModule.SIGNAL_SETTINGS_VERSION} bekleniyor).` });
    }
    const current = engineHost.settings;
    const section = (name) => ({ ...current[name], ...(isPlainObject(body[name]) ? body[name] : {}) });
    const settings = engineModule.sanitizeSignalSettings({
        version: engineModule.SIGNAL_SETTINGS_VERSION,
        momentum: section('momentum'),
        volume: section('volume'),
        funding: section('funding')
    });

    if (engineHost.stateTable !== false) {
        try {
            await writeEngineState('settings', settings);
        } catch (err) {
            console.error('[engine] Motor ayarları kaydedilemedi:', err.code || err.message);
            return res.status(500).json({ error: 'Motor ayarları kaydedilemedi. Lütfen tekrar deneyin.' });
        }
    }
    applyEngineSettings(settings, { local: true });
    console.log(`[engine] Motor ayarları güncellendi (kullanıcı: ${req.user.username}).`);
    res.json({ settings });
});

// Per-strategy scorecard of the measured signal outcomes (any signed-in user). ?days=7 (default) or 30; each
// process caches it for 60 s. Shape and verdict rules: server/outcomes.cjs buildScorecard / computeStats.
app.get('/api/scorecard', authenticateToken, async (req, res) => {
    let days = outcomesLib.SCORECARD_DAYS[0];
    if (req.query.days !== undefined) {
        const raw = typeof req.query.days === 'string' ? req.query.days.trim() : '';
        const parsed = /^\d+$/.test(raw) ? Number(raw) : NaN;
        if (!outcomesLib.SCORECARD_DAYS.includes(parsed)) {
            return res.status(400).json({ error: `days şu değerlerden biri olmalıdır: ${outcomesLib.SCORECARD_DAYS.join(', ')}.` });
        }
        days = parsed;
    }
    try {
        res.json(await outcomes.scorecard(days));
    } catch (err) {
        console.error('[outcomes] Sinyal karnesi hesaplanamadı:', err && (err.code || err.message));
        res.status(500).json({ error: 'Sinyal karnesi hesaplanamadı. Lütfen daha sonra tekrar deneyin.' });
    }
});

// ===== SIGNAL RELAY (several Node processes behind the host's proxy) =====
// The host runs the app as several Node processes at once and every browser stays connected to one of them,
// but io.emit only reaches the browsers of the emitting process. So every process (leader or standby) reads
// the DB every 3 s and re-emits what the other processes stored:
//  - 'new_signal': rows newer than its watermark minus 15 s (a slower process may insert a row with a slightly
//    older time), except the ids this process emitted itself or already relayed (bounded: 2000 ids / 1 h).
//    The watermark starts when the process starts: a process that boots later never replays history.
//  - 'signal_deleted' / 'signals_cleared': DELETE /api/signals[/:id] also stores a tombstone in engine_state
//    ('signals_deleted': the last 200 {id, at}; 'signals_cleared_at': ms); each process emits the new ones.
// Cost per process and pass: one indexed SELECT on signals (time_ms, else time) and one engine_state read that
// only returns rows changed in the last 15 s (normally none). DB errors are logged once per minute; the loop
// keeps going and stops on shutdown.
const RELAY_INTERVAL_MS = 3 * 1000;
const RELAY_OVERLAP_MS = 15 * 1000;
const RELAY_BATCH_LIMIT = 200;
const RELAY_MAX_PAGES = 5;          // per pass; a larger burst continues on the next pass
const RELAY_PASS_TIMEOUT_MS = 20 * 1000;
// A pass that timed out may still wait for the DB on a pool connection (10 per process): besides the current
// pass at most one such pass, so a hung DB never ties up more than 2 connections for the relay.
const RELAY_MAX_IN_FLIGHT = 2;
const RELAY_SEEN_MAX = 2000;
const RELAY_SEEN_TTL_MS = 60 * 60 * 1000;
// After a long DB outage only the last 30 min are caught up (well inside the 1 h memory of sent ids, so nothing
// is sent twice); older rows are still in GET /api/signals, which browsers reload on every reconnect.
const RELAY_MAX_LOOKBACK_MS = 30 * 60 * 1000;
const RELAY_WARN_MS = 60 * 1000;
const TOMBSTONES_KEEP = 200;
const SIGNALS_DELETED_KEY = 'signals_deleted';
const SIGNALS_CLEARED_KEY = 'signals_cleared_at';

const relay = {
    active: false,
    timer: null,
    pass: null,           // the pass in progress ({ startedAt })
    inFlight: 0,          // passes whose queries have not settled yet (a timed-out pass may still wait for the DB)
    startedAt: 0,         // rows older than this were history when the process started: never replayed
    watermark: 0,         // start of the last complete pass; the next pass reads from watermark - 15 s
    cursor: null,         // { column, value, id }: a burst larger than RELAY_MAX_PAGES pages continues after this row
    rescanFrom: null,     // after a clear: read the surviving rows again from here
    primed: false,        // the first complete pass is done
    seen: new Map(),      // signal id -> { at, timeMs }: emitted by this process (itself or relayed)
    deleted: new Map(),   // signal id -> at: deletions this process knows (its own or relayed)
    tombstonesPrimed: false,
    clearedAt: 0,         // newest "delete all" this process knows
    stateSince: 0,        // the tombstone read returns engine_state rows changed since then (0: both rows)
    changeSeq: 0,         // bumped by every delete / clear: a pass that overlapped one is redone
    tombstoneWrites: Promise.resolve()
};

// Oldest first (Map insertion order; entries are never re-inserted): drop by age, then by count.
const pruneRelayMap = (map, ttlMs, now) => {
    for (const [key, entry] of map) {
        const at = typeof entry === 'number' ? entry : entry.at;
        if (map.size <= RELAY_SEEN_MAX && now - at < ttlMs) break;
        map.delete(key);
    }
};

// Signals this process sends itself are remembered BEFORE they are inserted, so its relay never sends them twice.
const rememberRelayedSignal = (id, timeMs) => {
    if (relay.seen.has(id)) return;
    const now = Date.now();
    relay.seen.set(id, { at: now, timeMs });
    pruneRelayMap(relay.seen, RELAY_SEEN_TTL_MS, now);
};

// Deletions are bounded by count only: the stored list keeps the last 200, every one of them must stay known.
const rememberDeletedSignal = (id) => {
    if (relay.deleted.has(id)) return;
    const now = Date.now();
    relay.deleted.set(id, now);
    pruneRelayMap(relay.deleted, Infinity, now);
};

const noteSignalDeleted = (id) => {
    relay.changeSeq++;
    rememberDeletedSignal(String(id));
};

// Rows stored after `at` survived the clear: they are forgotten, so the next pass sends them again to the
// browsers that have just emptied their list.
const noteSignalsCleared = (at) => {
    relay.changeSeq++;
    if (at > relay.clearedAt) relay.clearedAt = at;
    for (const [id, entry] of relay.seen) {
        if (entry.timeMs >= at) relay.seen.delete(id);
    }
    relay.rescanFrom = relay.rescanFrom === null ? at : Math.min(relay.rescanFrom, at);
};

const cleanTombstones = (raw) => (Array.isArray(raw)
    ? raw.filter(t => isPlainObject(t) && typeof t.id === 'string' && t.id !== '' && Number.isFinite(t.at))
    : []);

// Serialised within this process. Two processes deleting in the very same moment may still lose one entry
// (read-modify-write): the browsers of the other processes then keep that signal until their next reload.
const queueTombstoneWrite = (label, write) => {
    if (engineHost.stateTable !== true) return Promise.resolve();
    const next = relay.tombstoneWrites
        .then(() => withTimeout(write(), ENGINE_LOCK_QUERY_TIMEOUT_MS, label))
        .catch(err => warnThrottled('tombstone', RELAY_WARN_MS, '[relay] Silme bilgisi diğer süreçlere iletilemedi:', err.code || err.message));
    relay.tombstoneWrites = next;
    return next;
};

const recordDeleteTombstone = (id) => queueTombstoneWrite('silme kaydı', async () => {
    const list = cleanTombstones(await readEngineState(SIGNALS_DELETED_KEY)).filter(t => t.id !== String(id));
    list.push({ id: String(id), at: Date.now() });
    await writeEngineState(SIGNALS_DELETED_KEY, list.slice(-TOMBSTONES_KEEP));
});

const recordClearTombstone = (at) => queueTombstoneWrite('temizleme kaydı', () => writeEngineState(SIGNALS_CLEARED_KEY, at));

// Deletions made through other processes. The first read only learns the current state (no replay at boot).
const relayTombstones = async (pass, current) => {
    if (engineHost.stateTable !== true) return;
    const [rows] = await db.query(
        'SELECT k, v, updated_at FROM engine_state WHERE k IN (?, ?) AND updated_at >= ?',
        [SIGNALS_DELETED_KEY, SIGNALS_CLEARED_KEY, relay.stateSince]
    );
    if (!current()) return;
    const values = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
        try {
            values.set(row.k, JSON.parse(row.v));
        } catch { /* malformed: ignored */ }
    }
    const announce = relay.tombstonesPrimed;
    const clearedAt = Number(values.get(SIGNALS_CLEARED_KEY));
    if (Number.isFinite(clearedAt) && clearedAt > relay.clearedAt) {
        if (announce) {
            noteSignalsCleared(clearedAt);
            io.emit('signals_cleared');
        } else {
            relay.clearedAt = clearedAt;
        }
    }
    for (const { id } of cleanTombstones(values.get(SIGNALS_DELETED_KEY))) {
        if (relay.deleted.has(id)) continue;
        if (announce) {
            noteSignalDeleted(id);
            io.emit('signal_deleted', { id });
        } else {
            rememberDeletedSignal(id);
        }
    }
    relay.tombstonesPrimed = true;
    relay.stateSince = pass.startedAt - RELAY_OVERLAP_MS;
};

const signalRowTimeMs = (row) => {
    const ms = row.time_ms === null || row.time_ms === undefined ? NaN : Number(row.time_ms);
    return Number.isFinite(ms) ? ms : Date.parse(row.time);
};

// New signals stored by other processes. Pages are keyed on (time, id): one engine pass stores all its signals
// with the same time, so a burst of more than 200 rows shares one value and only the id tells them apart.
const relaySignals = async (pass, current) => {
    const useTimeMs = await hasSignalsTimeMs();
    if (!current()) return;
    const seq = relay.changeSeq;
    const column = useTimeMs ? 'time_ms' : 'time';
    const columns = `id, strategy, symbol, side, price, time, ${useTimeMs ? 'time_ms, ' : ''}note, source, confidence`;
    let from = relay.watermark - RELAY_OVERLAP_MS;
    if (relay.rescanFrom !== null) from = Math.min(from, relay.rescanFrom);
    from = Math.max(from, pass.startedAt - RELAY_MAX_LOOKBACK_MS);
    // { column, value, id }: the last row of the previous (incomplete) pass; dropped when a clear asks for a rescan
    let after = relay.rescanFrom === null && relay.cursor && relay.cursor.column === column ? relay.cursor : null;
    const found = new Map(); // id -> { row, timeMs }
    let complete = false;
    for (let page = 0; page < RELAY_MAX_PAGES; page++) {
        const [rows] = after
            ? await db.query(
                `SELECT ${columns} FROM signals WHERE ${column} >= ? AND (${column} > ? OR id > ?) ORDER BY ${column} ASC, id ASC LIMIT ?`,
                [after.value, after.value, after.id, RELAY_BATCH_LIMIT]
            )
            : await db.query(
                `SELECT ${columns} FROM signals WHERE ${column} >= ? ORDER BY ${column} ASC, id ASC LIMIT ?`,
                [useTimeMs ? from : new Date(from).toISOString(), RELAY_BATCH_LIMIT]
            );
        if (!current()) return;
        const list = Array.isArray(rows) ? rows : [];
        for (const row of list) {
            if (!found.has(row.id) && !relay.seen.has(row.id)) found.set(row.id, { row, timeMs: signalRowTimeMs(row) });
        }
        if (list.length < RELAY_BATCH_LIMIT) {
            complete = true;
            break;
        }
        const last = list[list.length - 1]; // a full page: the next one starts right after its last row
        after = { column, value: last[column], id: last.id };
    }

    const fresh = [];
    for (const { row, timeMs } of found.values()) {
        // History when the process started (or a row without a usable time): remembered, never sent.
        if (!Number.isFinite(timeMs) || (!relay.primed && timeMs < relay.startedAt)) {
            rememberRelayedSignal(row.id, timeMs);
            continue;
        }
        fresh.push({ dto: toSignalDto(row), timeMs });
    }
    if (fresh.length > 0) await attachSignalMeta(fresh.map(entry => entry.dto)); // engine / magnitude
    if (!current() || relay.changeSeq !== seq) return; // a delete / clear ran meanwhile: redone next pass
    for (const { dto, timeMs } of fresh) {
        if (relay.seen.has(dto.id) || relay.deleted.has(dto.id)) continue;
        rememberRelayedSignal(dto.id, timeMs);
        io.emit('new_signal', dto);
    }
    relay.rescanFrom = null;
    if (complete) {
        relay.cursor = null;
        relay.primed = true;
        relay.watermark = Math.max(relay.watermark, pass.startedAt);
    } else {
        relay.cursor = after;
        warnThrottled('relay-burst', RELAY_WARN_MS, `[relay] ${RELAY_MAX_PAGES * RELAY_BATCH_LIMIT}+ yeni sinyal: aktarım sonraki turda sürüyor.`);
    }
};

const relayTick = async () => {
    if (!relay.active || relay.pass) return;
    if (relay.inFlight >= RELAY_MAX_IN_FLIGHT) {
        warnThrottled('relay-stuck', RELAY_WARN_MS, '[relay] Önceki aktarım sorguları veritabanından hâlâ yanıt bekliyor; yeni tur onlar bitince başlayacak.');
        scheduleRelay();
        return;
    }
    const pass = { startedAt: Date.now() };
    relay.pass = pass;
    const current = () => relay.active && relay.pass === pass;
    const run = async () => {
        try {
            await relayTombstones(pass, current);
        } catch (err) {
            if (current()) warnThrottled('relay-tombstones', RELAY_WARN_MS, '[relay] Silinen sinyal bilgisi okunamadı:', err.code || err.message);
        }
        if (!current()) return;
        try {
            await relaySignals(pass, current);
        } catch (err) {
            if (current()) {
                warnThrottled('relay-signals', RELAY_WARN_MS,
                    '[relay] Yeni sinyaller okunamadı (diğer süreçlerin sinyalleri bu sürece bağlı tarayıcılara iletilemiyor, 3 sn sonra yeniden denenecek):',
                    err.code || err.message);
            }
        }
    };
    relay.inFlight++;
    const running = run().finally(() => { relay.inFlight--; });
    try {
        await withTimeout(running, RELAY_PASS_TIMEOUT_MS, 'sinyal aktarımı');
    } catch (err) {
        warnThrottled('relay-timeout', RELAY_WARN_MS, `[relay] ${err.message}; sonraki tur başlıyor.`);
    } finally {
        if (relay.pass === pass) relay.pass = null;
        scheduleRelay();
    }
};

const scheduleRelay = () => {
    if (!relay.active) return;
    if (relay.timer) clearTimeout(relay.timer);
    relay.timer = unrefTimer(setTimeout(() => {
        relay.timer = null;
        relayTick().catch(() => { /* never rejects; logged inside */ });
    }, RELAY_INTERVAL_MS));
};

// Started once the HTTP server listens, in every process (ENGINE_MODE=off included: it serves browsers too).
const startSignalRelay = () => {
    if (relay.active) return;
    relay.active = true;
    relay.startedAt = Date.now();
    relay.watermark = relay.startedAt;
    scheduleRelay();
};

const stopSignalRelay = () => {
    relay.active = false;
    if (relay.timer) clearTimeout(relay.timer);
    relay.timer = null;
    relay.pass = null;
};

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
    console.log(`📡 Sinyal motoru: ${ENGINE_MODE === 'off' ? 'kapalı (ENGINE_MODE=off)' : engineModule ? 'sunucuda (kilit alınınca başlar)' : 'paket yok, devre dışı'}`);
    startSignalRelay();
    startEngineHost().catch(err => console.error('[engine] Motor altyapısı başlatılamadı:', err && (err.code || err.message)));
});

let exitRequested = false;
const exitGracefully = (signal) => {
    if (exitRequested) return;
    exitRequested = true;
    console.log(`[server] ${signal} alındı: sinyal motoru durduruluyor, kilit bırakılıyor.`);
    unrefTimer(setTimeout(() => process.exit(0), 5000));
    shutdownEngineHost()
        .catch(err => console.error('[engine] Kapanış sırasında hata:', err && (err.code || err.message)))
        .finally(() => process.exit(0));
};
process.once('SIGTERM', () => exitGracefully('SIGTERM'));
process.once('SIGINT', () => exitGracefully('SIGINT'));

module.exports = {
    app,
    server,
    io,
    // Engine host internals, for tests and diagnostics only.
    engineHost: {
        state: engineHost,
        getStatus: buildEngineStatus,
        tryLockNow: tryBecomeLeader,
        checkLockNow: checkEngineLock,
        refreshShared: refreshSharedState,
        publishSignals: handleEngineSignals,
        persistCooldowns: scheduleCooldownWrite,
        flushCooldowns,
        heartbeatNow: () => {
            sendLeaderHeartbeat();
            return engineHost.heartbeatPromise || Promise.resolve();
        },
        shutdown: shutdownEngineHost
    },
    // Signal outcome tracker (server/outcomes.cjs), for tests and diagnostics only.
    outcomes,
    // Cross-process signal relay internals, for tests and diagnostics only.
    signalRelay: {
        state: relay,
        tickNow: relayTick,
        stop: stopSignalRelay
    }
};
