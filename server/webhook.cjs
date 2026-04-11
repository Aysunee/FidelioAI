// server/webhook.cjs
//
// Minimal, isolated webhook backend for TradingView alerts.
// Runs in a Docker container on a dedicated Windows PC.
// Does NOT share database or state with server/index.cjs (MySQL production).
//
// Reads runtime config from .env.webhook via `node --env-file=.env.webhook`.
// Persists signals to Postgres (via pg.Pool).
// Broadcasts new signals over socket.io on a dedicated path (/webhook-ws).
//
// Spec: docs/superpowers/specs/2026-04-11-webhook-connection-design-amendment-01.md §B.1

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

// --- Config from env ----------------------------------------------------

const PORT = parseInt(process.env.PORT || '3001', 10);
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

if (!WEBHOOK_SECRET) {
    console.warn('[boot] WEBHOOK_SECRET is not set — /api/webhook will return 500 until it is configured');
}
if (!DATABASE_URL) {
    console.error('[boot] DATABASE_URL is not set — cannot start');
    process.exit(1);
}

// --- Postgres pool ------------------------------------------------------

const pool = new Pool({ connectionString: DATABASE_URL });

pool.on('error', (err) => {
    console.error('[pg] pool error:', err);
});

async function loadSignals(limit = 500) {
    try {
        const { rows } = await pool.query(
            `SELECT id, strategy, symbol, side, price::float AS price, time, note, source, confidence::float AS confidence
             FROM signals ORDER BY time DESC LIMIT $1`,
            [limit]
        );
        return rows;
    } catch (error) {
        console.error('[pg] loadSignals error:', error);
        return [];
    }
}

async function saveSignal(signal) {
    try {
        await pool.query(
            `INSERT INTO signals (id, strategy, symbol, side, price, time, note, source, confidence)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (id) DO NOTHING`,
            [signal.id, signal.strategy, signal.symbol, signal.side, signal.price,
             signal.time, signal.note, signal.source, signal.confidence]
        );
        return true;
    } catch (error) {
        console.error('[pg] saveSignal error:', error);
        return false;
    }
}

// --- Express + middleware ----------------------------------------------

const app = express();
const server = http.createServer(app);

// Caddy is our immediate reverse proxy. Trust its X-Forwarded-For header so
// req.ip reports the real client IP (used by rate limiter keying + audit logs).
app.set('trust proxy', 1);

app.use(cors({
    origin: (origin, callback) => {
        // Server-to-server requests (TradingView, curl) have no Origin header
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        console.warn('[cors] Rejected origin:', origin);
        return callback(new Error('CORS: origin not allowed'));
    },
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(bodyParser.json({ limit: '64kb' }));

const io = new Server(server, {
    cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] },
    path: '/webhook-ws'  // dedicated path so it does not collide with any other
                         // socket.io instance the frontend might talk to
});

io.on('connection', (socket) => {
    console.log('[ws] client connected:', socket.id);
    socket.on('disconnect', (reason) => {
        console.log('[ws] client disconnected:', socket.id, reason);
    });
});

// --- Rate limit (webhook endpoint only) ---------------------------------

const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,   // 1 minute
    max: 100,              // 100 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' }
});

// --- Routes -------------------------------------------------------------

app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.status(200).json({ status: 'ok', uptime: process.uptime() });
    } catch (e) {
        // Log full error server-side, but do NOT echo DB internals (hostnames,
        // user, database name) to an unauthenticated public endpoint.
        console.error('[health] db query failed:', e);
        res.status(500).json({ status: 'degraded', error: 'database unreachable' });
    }
});

app.get('/api/webhook/signals', async (req, res) => {
    // Endpoint returns full signal history — gate it behind the same
    // WEBHOOK_SECRET as POST. Frontend sends the secret via X-Webhook-Secret
    // header (pulled from localStorage). TradingView never hits this endpoint.
    if (!WEBHOOK_SECRET) {
        return res.status(500).json({ error: 'Server misconfigured: WEBHOOK_SECRET not set' });
    }
    const providedSecret = req.header('X-Webhook-Secret');
    if (providedSecret !== WEBHOOK_SECRET) {
        console.warn('[signals] Rejected - invalid or missing X-Webhook-Secret from', req.ip);
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const requested = parseInt(req.query.limit || '500', 10);
    const safeRequested = Number.isFinite(requested) ? requested : 500;
    const limit = Math.min(Math.max(safeRequested, 1), 5000);
    const signals = await loadSignals(limit);
    res.json(signals);
});

app.post('/api/webhook', webhookLimiter, async (req, res) => {
    if (!WEBHOOK_SECRET) {
        return res.status(500).json({ error: 'Server misconfigured: WEBHOOK_SECRET not set' });
    }
    if (req.body.secret !== WEBHOOK_SECRET) {
        console.warn('[webhook] Rejected - invalid or missing secret from', req.ip);
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Strip secret before any further processing / logging
    const { secret: _secret, ...data } = req.body;

    if (!data.symbol || !data.side || !data.price) {
        return res.status(400).json({ error: 'Missing required fields: symbol, side, price' });
    }

    const normalizedSide = String(data.side).toUpperCase();
    if (!['BUY', 'SELL', 'LONG', 'SHORT'].includes(normalizedSide)) {
        return res.status(400).json({ error: `Invalid side: ${data.side} (must be BUY/SELL/LONG/SHORT)` });
    }

    const signal = {
        id: data.id || `wh_${Date.now()}`,
        strategy: data.strategy || 'External_Webhook',
        symbol: String(data.symbol).toUpperCase(),
        side: normalizedSide,
        price: parseFloat(data.price),
        time: data.time || new Date().toISOString(),
        note: data.note || 'Received via Webhook',
        source: data.source || 'WEBHOOK',
        confidence: data.confidence != null ? parseFloat(data.confidence) : 0.95
    };

    if (!Number.isFinite(signal.price)) {
        return res.status(400).json({ error: `Invalid price: ${data.price}` });
    }
    if (!Number.isFinite(signal.confidence)) {
        return res.status(400).json({ error: `Invalid confidence: ${data.confidence}` });
    }

    const saved = await saveSignal(signal);
    if (!saved) {
        return res.status(500).json({ error: 'Failed to persist signal' });
    }

    io.emit('new_signal', signal);
    console.log('[webhook] accepted:', signal.symbol, signal.side, signal.price, 'id=', signal.id);

    return res.status(200).json({ success: true, signalId: signal.id });
});

// --- Error handler (last middleware) ------------------------------------

app.use((err, req, res, next) => {
    if (err && err.message && err.message.startsWith('CORS:')) {
        return res.status(403).json({ error: err.message });
    }
    console.error('[app] unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error' });
});

// --- Start --------------------------------------------------------------

server.listen(PORT, BIND_HOST, () => {
    console.log(`🚀 Webhook backend listening on ${BIND_HOST}:${PORT}`);
    console.log(`👉 Webhook endpoint:   http(s)://<public-url>/api/webhook`);
    console.log(`👉 Signal history:     http(s)://<public-url>/api/webhook/signals`);
    console.log(`👉 Health:             http(s)://<public-url>/health`);
    console.log(`🔌 Socket.IO path:     /webhook-ws`);
});

// Graceful shutdown — close http server first (drains in-flight requests),
// then drain the pg pool, then exit. Without the Promise wrap around
// server.close(), process.exit fires before existing connections finish.
const shutdown = async (signal) => {
    console.log(`[boot] ${signal} received, shutting down...`);
    try {
        await new Promise((resolve) => server.close(resolve));
        console.log('[boot] http server closed');
    } catch (e) {
        console.error('[boot] http server close error:', e);
    }
    try {
        await pool.end();
        console.log('[boot] pg pool drained');
    } catch (e) {
        console.error('[boot] pg pool close error:', e);
    }
    process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
