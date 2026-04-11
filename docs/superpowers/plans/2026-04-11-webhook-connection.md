# Webhook Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect TradingView webhook alerts to the FidelioAI backend via `gumruc.com`, persist signals in Postgres, render the `WebhookManager` UI, and deploy all services persistently on the user's home laptop.

**Architecture:** TradingView → HTTPS POST → Caddy (Let's Encrypt) → Node.js backend (`127.0.0.1:3001`) → Postgres (Docker) + socket.io broadcast → local frontend. Laptop-hosted, port-forwarded, free. Fallback: Cloudflare Tunnel if port forward fails.

**Tech Stack:** Node.js 20 (express, socket.io, pg, express-rate-limit), Docker Compose (postgres:16-alpine), Caddy, macOS launchd, Vite + React 19 frontend (socket.io-client), TypeScript.

**Spec:** `docs/superpowers/specs/2026-04-11-webhook-connection-design.md`

**Important assumptions:**
- Backend lives on a dedicated, always-on macOS laptop at home
- Laptop has genuine public IP (not CGNAT) — Task 25 verifies this; if fails, switch to Cloudflare Tunnel per spec Section 3.4
- `gumruc.com` registered to the user, DNS panel accessible
- User has TradingView plan with webhook alerts (Essential $14.95/mo or above)
- Node 20.6+ installed (for native `--env-file` support)
- Working directory is `/Users/mertaysune/fidelioai/FidelioAI`

**Testing approach:** No test framework exists in the repo. Verification uses `curl` commands with explicit expected output, `docker exec psql` for DB assertions, `npx tsc --noEmit` for type safety, and manual browser smoke tests at phase boundaries. Each task's verification commands and expected output are provided inline.

**Commits:** Frequent, one per task or sub-task. Branch: `feature/webhook-connection`.

---

## Phase Overview

| Phase | Tasks | Outcome |
|---|---|---|
| **1. Preflight** | 1–2 | Branch created, .gitignore set, Node deps installed |
| **2. Backend Infra** | 3–5 | Postgres running in Docker, schema initialized, .env populated |
| **3. Backend Code** | 6–11 | `server/index.cjs` refactored: pg, secret, CORS, rate limit, bind 127.0.0.1, scripts, smoke test |
| **4. Frontend Code** | 12–23 | `services/config.ts` + all 8 files refactored, WebhookManager bug fixes + localStorage secret + render in App.tsx, browser smoke test |
| **5. Network** | 24–27 | CGNAT check, DNS, port forward, macOS sleep settings |
| **6. Deploy** | 28–31 | Caddy + Let's Encrypt, launchd backend, persistent services |
| **7. E2E** | 32–33 | TradingView alert configured, uçtan uca latency test |
| **8. Cleanup** | 34–35 | Success criteria, merge decision |

---

## Task 1: Preflight — Branch & Working Tree Safety

**Context:** The repo has many uncommitted WIP changes and untracked files unrelated to webhook work. We will create a feature branch and use targeted `git add <file>` (not `git add -A`) to keep our commits isolated.

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Inspect current working tree**

```bash
git status --short
git branch --show-current
```

Expected: current branch is `main`, many `M` and `??` entries. Note the file list — it represents user's existing WIP that we will NOT touch.

- [ ] **Step 2: Create feature branch from current HEAD**

```bash
git checkout -b feature/webhook-connection
git branch --show-current
```

Expected output:
```
feature/webhook-connection
```

The WIP moves with us to the new branch. Subsequent commits will use explicit file paths to avoid sweeping WIP into our commits.

- [ ] **Step 3: Update `.gitignore` to exclude secrets, DB data, old JSON**

Read `.gitignore`:
```bash
cat .gitignore
```

Append these lines (use the Edit tool or a text editor — not `echo >>` since we want to preserve existing content):

```
# Webhook connection work
.env
postgres_data/
server/signals_db.json
```

- [ ] **Step 4: Verify .gitignore changes staged cleanly**

```bash
git diff .gitignore
```

Expected: only the 4 lines added (blank line + comment + 3 paths).

- [ ] **Step 5: Commit gitignore**

```bash
git add .gitignore
git commit -m "chore: gitignore webhook env, postgres data, legacy signals JSON"
```

---

## Task 2: Install New Backend Dependencies

**Files:**
- Modify: `package.json` (via `npm install`)
- Modify: `package-lock.json`

- [ ] **Step 1: Install `pg` and `express-rate-limit`**

```bash
npm install pg express-rate-limit
```

Expected: both packages added, no vulnerability warnings that block install. `package.json` `dependencies` now includes `"pg"` and `"express-rate-limit"`.

- [ ] **Step 2: Verify versions and resolve**

```bash
node -e "console.log(require('./package.json').dependencies.pg, require('./package.json').dependencies['express-rate-limit'])"
```

Expected: two version strings printed (e.g. `^8.x ^7.x`).

- [ ] **Step 3: Verify Node version is 20.6+ for native `--env-file` support**

```bash
node --version
```

Expected: `v20.6.0` or higher. If lower: `brew install node@20` and re-check. If still old: use `dotenv` package instead (fallback noted here but not expected).

- [ ] **Step 4: Commit dependency changes (targeted add)**

```bash
git add package.json package-lock.json
git commit -m "deps: add pg and express-rate-limit for Postgres + DoS protection"
```

---

## Task 3: Docker Compose + Postgres Migration

**Files:**
- Create: `docker-compose.yml`
- Create: `server/migrations/001_init.sql`

- [ ] **Step 1: Create `docker-compose.yml`**

Write the file with this exact content:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: fidelio_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: fidelio
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: fidelio_signals
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - ./postgres_data:/var/lib/postgresql/data
      - ./server/migrations:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U fidelio -d fidelio_signals"]
      interval: 10s
      timeout: 5s
      retries: 5
```

Key properties:
- `ports: 127.0.0.1:5432:5432` — only localhost-accessible. Internet traffic cannot reach Postgres even if modem forwards port 5432.
- `./postgres_data` host-mounted — survives `docker compose down/up`, gitignored.
- `./server/migrations:/docker-entrypoint-initdb.d:ro` — SQL files here are executed on first container start (read-only mount).

- [ ] **Step 2: Create migration directory**

```bash
mkdir -p server/migrations
```

- [ ] **Step 3: Create `server/migrations/001_init.sql`**

Write the file with this exact content:

```sql
CREATE TABLE IF NOT EXISTS signals (
  id           TEXT PRIMARY KEY,
  strategy     TEXT NOT NULL,
  symbol       TEXT NOT NULL,
  side         TEXT NOT NULL CHECK (side IN ('BUY','SELL','LONG','SHORT')),
  price        NUMERIC NOT NULL,
  time         TIMESTAMPTZ NOT NULL,
  note         TEXT,
  source       TEXT DEFAULT 'WEBHOOK',
  confidence   NUMERIC DEFAULT 0.95,
  received_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_time   ON signals (time DESC);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals (symbol);
CREATE INDEX IF NOT EXISTS idx_signals_source ON signals (source);
```

- [ ] **Step 4: Commit Docker compose + migration**

```bash
git add docker-compose.yml server/migrations/001_init.sql
git commit -m "feat: docker-compose + initial signals schema migration"
```

---

## Task 4: Generate Secrets & Create `.env`

**Files:**
- Create: `.env` (gitignored)

- [ ] **Step 1: Confirm Docker Desktop is running**

```bash
docker info > /dev/null 2>&1 && echo "Docker OK" || echo "Docker NOT running"
```

Expected: `Docker OK`. If not, open Docker Desktop app and wait for the green dot, then re-run.

- [ ] **Step 2: Generate secrets**

```bash
WEBHOOK_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
echo "WEBHOOK_SECRET=$WEBHOOK_SECRET"
echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
```

Copy both values — you will paste them into `.env` next.

- [ ] **Step 3: Read existing GEMINI_API_KEY from current env or user**

The user already has `GEMINI_API_KEY` set somewhere (likely `.env.local` or shell env). Find it:

```bash
grep -r "GEMINI_API_KEY" .env.local 2>/dev/null || echo "not in .env.local"
```

If not found, ask the user to provide it. This value will go into `.env`.

- [ ] **Step 4: Create `.env`**

Write `.env` at repo root with this content (replace the `<...>` placeholders with the generated values):

```ini
PORT=3001
WEBHOOK_SECRET=<paste generated WEBHOOK_SECRET here, no angle brackets>
ALLOWED_ORIGINS=http://localhost:3000
DATABASE_URL=postgres://fidelio:<paste generated POSTGRES_PASSWORD here>@localhost:5432/fidelio_signals
GEMINI_API_KEY=<paste existing GEMINI_API_KEY>
POSTGRES_PASSWORD=<paste generated POSTGRES_PASSWORD here>
```

Both `<...>` values for POSTGRES_PASSWORD must be **identical** — same string in both `DATABASE_URL` and `POSTGRES_PASSWORD` lines. `DATABASE_URL` is used by the Node backend; `POSTGRES_PASSWORD` is used by docker-compose to set the DB user's password. A mismatch means backend can't connect.

- [ ] **Step 5: Verify `.env` is gitignored**

```bash
git status --short | grep -F ".env" || echo "OK: .env not tracked"
```

Expected: `OK: .env not tracked`. If `.env` shows as `??`, the `.gitignore` entry from Task 1 is wrong — check it.

- [ ] **Step 6: No commit** — `.env` must never be committed. Move on.

---

## Task 5: Start Postgres & Verify Schema

**Files:**
- (Runtime only — no code changes)

- [ ] **Step 1: Start Postgres container**

```bash
docker compose --env-file .env up -d postgres
```

Expected output mentions `Container fidelio_postgres Created` then `Started`.

- [ ] **Step 2: Wait for healthy status (~10–15s)**

```bash
sleep 12
docker compose ps
```

Expected: STATUS column shows `Up X seconds (healthy)`. If `unhealthy` or `starting` lingers, run `docker compose logs postgres` and look for errors (most common: wrong `POSTGRES_PASSWORD` between compose and env file).

- [ ] **Step 3: Verify schema created by migration**

```bash
docker exec -it fidelio_postgres psql -U fidelio -d fidelio_signals -c "\dt"
```

Expected output includes a row for the `signals` table:
```
 Schema |  Name   | Type  |  Owner
--------+---------+-------+---------
 public | signals | table | fidelio
```

- [ ] **Step 4: Verify indexes**

```bash
docker exec -it fidelio_postgres psql -U fidelio -d fidelio_signals -c "\di"
```

Expected: `signals_pkey`, `idx_signals_time`, `idx_signals_symbol`, `idx_signals_source`.

- [ ] **Step 5: Verify empty state**

```bash
docker exec -it fidelio_postgres psql -U fidelio -d fidelio_signals -c "SELECT COUNT(*) FROM signals;"
```

Expected: `count` = `0`.

- [ ] **Step 6: No commit** — this is runtime verification, no code changed.

---

## Task 6: Backend — pg Client Helpers

**Context:** Replace the JSON-file persistence (`loadSignals` / `saveSignal` / `DB_FILE`) with a Postgres pool in `server/index.cjs`. Keep the rest of the file unchanged for now — other tasks add secret validation, CORS tightening, etc.

**Files:**
- Modify: `server/index.cjs`

- [ ] **Step 1: Open `server/index.cjs` and locate the current helpers**

The current code around line 25-55:
```js
const fs = require('fs');
const path = require('path');
const DB_FILE = path.join(__dirname, 'signals_db.json');

const loadSignals = () => { /* ... */ };
const saveSignal = (signal) => { /* ... */ };
```

- [ ] **Step 2: Replace the `fs/path` imports and helpers with a pg-based implementation**

Use the Edit tool to replace this block:

```js
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'signals_db.json');

// Helper: Load signals
const loadSignals = () => {
    try {
        if (!fs.existsSync(DB_FILE)) return [];
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading signals DB:', error);
        return [];
    }
};

// Helper: Save signal
const saveSignal = (signal) => {
    try {
        const signals = loadSignals();
        signals.unshift(signal); // Add to beginning
        // Keep last 30,000 signals as requested
        const trimmed = signals.slice(0, 30000);
        fs.writeFileSync(DB_FILE, JSON.stringify(trimmed, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving signal to DB:', error);
        return false;
    }
};
```

With this block:

```js
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err) => {
    console.error('[pg] Unexpected pool error:', err);
});

// Helper: Load signals (most recent first)
async function loadSignals(limit = 500) {
    try {
        const { rows } = await pool.query(
            'SELECT id, strategy, symbol, side, price::float AS price, time, note, source, confidence::float AS confidence FROM signals ORDER BY time DESC LIMIT $1',
            [limit]
        );
        return rows;
    } catch (error) {
        console.error('[pg] loadSignals error:', error);
        return [];
    }
}

// Helper: Save signal (idempotent by id)
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
```

Key points:
- `loadSignals` is now `async`; callers must `await`.
- `price::float` cast in the SELECT — Postgres `NUMERIC` returns as a string in `pg` by default; casting to float makes it a JS number.
- `ON CONFLICT (id) DO NOTHING` — naive dedup on primary key.

- [ ] **Step 3: Update `/api/signals` handler to `await loadSignals()`**

Find (around line 60):
```js
app.get('/api/signals', (req, res) => {
    const signals = loadSignals();
    res.json(signals);
});
```

Replace with:
```js
app.get('/api/signals', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '500', 10), 5000);
    const signals = await loadSignals(limit);
    res.json(signals);
});
```

- [ ] **Step 4: Update `/api/webhook` handler to `await saveSignal(signal)`**

Find (around line 66):
```js
app.post('/api/webhook', (req, res) => {
    // ...
    saveSignal(signal);
    io.emit('new_signal', signal);
    return res.status(200).json({ success: true, signalId: signal.id });
});
```

Make the handler `async` and `await saveSignal`:
```js
app.post('/api/webhook', async (req, res) => {
    const data = req.body;
    console.log('Webhook received:', data);

    if (!data.symbol || !data.side || !data.price) {
        return res.status(400).json({ error: 'Missing required fields: symbol, side, price' });
    }

    const signal = {
        id: data.id || `wh_${Date.now()}`,
        strategy: data.strategy || 'External_Webhook',
        symbol: data.symbol.toUpperCase(),
        side: data.side.toUpperCase(),
        price: parseFloat(data.price),
        time: data.time || new Date().toISOString(),
        note: data.note || 'Received via Webhook',
        source: data.source || 'WEBHOOK',
        confidence: data.confidence || 0.95
    };

    await saveSignal(signal);
    io.emit('new_signal', signal);

    return res.status(200).json({ success: true, signalId: signal.id });
});
```

Note: secret validation will be added in Task 7 — don't add it yet; we want Task 6 to be an isolated pg migration commit.

- [ ] **Step 5: Sanity check the file parses**

```bash
node --check server/index.cjs
```

Expected: no output (success). If a syntax error prints, fix it before continuing.

- [ ] **Step 6: Commit Postgres migration**

```bash
git add server/index.cjs
git commit -m "feat(backend): migrate signal persistence from JSON file to Postgres (pg.Pool)"
```

---

## Task 7: Backend — Secret Validation

**Files:**
- Modify: `server/index.cjs`

- [ ] **Step 1: Add `WEBHOOK_SECRET` to the top of `server/index.cjs`**

Near the top of the file (after `const app = express();`), add:

```js
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
    console.warn('[boot] WEBHOOK_SECRET is not set — /api/webhook will return 500');
}
```

- [ ] **Step 2: Add secret check at the top of `POST /api/webhook` handler**

Inside the handler, as the first lines (before `const data = req.body;`):

```js
if (!WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'Server misconfigured: WEBHOOK_SECRET not set' });
}
if (req.body.secret !== WEBHOOK_SECRET) {
    console.warn('[webhook] Rejected - invalid or missing secret from', req.ip);
    return res.status(401).json({ error: 'Unauthorized' });
}
// Strip secret before logging / persistence
const { secret: _secret, ...data } = req.body;
```

Then change the earlier line from `const data = req.body;` to the destructure above. The rest of the handler continues using `data` as before.

**Important:** Replace `const data = req.body;` with the new destructure. Don't leave both lines.

- [ ] **Step 3: Sanity check**

```bash
node --check server/index.cjs
```

Expected: no output.

- [ ] **Step 4: Run the backend**

```bash
node --env-file=.env server/index.cjs &
BACKEND_PID=$!
sleep 1
```

Expected log: `🚀 Backend listening on http://localhost:3001` (or similar) and `👉 Webhook Endpoint: ...`.

- [ ] **Step 5: Verify missing-secret returns 401**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","side":"BUY","price":65000}'
```

Expected: `401`.

- [ ] **Step 6: Verify wrong-secret returns 401**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"secret":"wrong","symbol":"BTCUSDT","side":"BUY","price":65000}'
```

Expected: `401`.

- [ ] **Step 7: Verify correct-secret returns 200**

```bash
SECRET=$(grep '^WEBHOOK_SECRET=' .env | cut -d= -f2)
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/webhook \
  -H "Content-Type: application/json" \
  -d "{\"secret\":\"$SECRET\",\"symbol\":\"BTCUSDT\",\"side\":\"BUY\",\"price\":65000,\"strategy\":\"test_task7\"}"
```

Expected: `200`.

- [ ] **Step 8: Confirm signal was inserted**

```bash
docker exec fidelio_postgres psql -U fidelio -d fidelio_signals \
  -c "SELECT id,strategy,symbol,price FROM signals WHERE strategy='test_task7';"
```

Expected: at least 1 row with `strategy = test_task7`.

- [ ] **Step 9: Kill the test backend**

```bash
kill $BACKEND_PID
```

- [ ] **Step 10: Commit**

```bash
git add server/index.cjs
git commit -m "feat(backend): require WEBHOOK_SECRET in POST /api/webhook body"
```

---

## Task 8: Backend — CORS Allowlist

**Files:**
- Modify: `server/index.cjs`

- [ ] **Step 1: Replace the `app.use(cors(...))` block**

Find the current CORS config (around line 11-15):

```js
app.use(cors({
    origin: "*", // Allow all origins for local network access
    methods: ["GET", "POST"]
}));
```

Replace with:

```js
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Server-to-server requests (TradingView, curl) have no Origin header
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        console.warn('[cors] Rejected origin:', origin);
        return callback(new Error('CORS: origin not allowed'));
    },
    methods: ['GET', 'POST'],
    credentials: true
}));
```

- [ ] **Step 2: Update socket.io CORS to use the same allowlist**

Find (around line 18):

```js
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for socket.io
        methods: ["GET", "POST"]
    }
});
```

Replace with:

```js
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST']
    }
});
```

- [ ] **Step 3: Sanity check**

```bash
node --check server/index.cjs
```

Expected: no output.

- [ ] **Step 4: Start backend**

```bash
node --env-file=.env server/index.cjs &
BACKEND_PID=$!
sleep 1
```

- [ ] **Step 5: Verify allowed origin passes**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: http://localhost:3000" http://localhost:3001/health
```

Expected: `200`.

- [ ] **Step 6: Verify disallowed origin is blocked**

```bash
curl -s -H "Origin: http://evil.example" http://localhost:3001/health 2>&1 | head -5
```

Expected: error response / no JSON body (CORS middleware throws).

- [ ] **Step 7: Verify no-origin (server-to-server) still works**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/health
```

Expected: `200` (TradingView will have no `Origin` header, so this path must work).

- [ ] **Step 8: Kill backend**

```bash
kill $BACKEND_PID
```

- [ ] **Step 9: Commit**

```bash
git add server/index.cjs
git commit -m "feat(backend): tighten CORS from wildcard to ALLOWED_ORIGINS allowlist"
```

---

## Task 9: Backend — Rate Limit on `/api/webhook`

**Files:**
- Modify: `server/index.cjs`

- [ ] **Step 1: Import `express-rate-limit` at the top with other requires**

Near the top of the file (after `const bodyParser = require('body-parser');`):

```js
const rateLimit = require('express-rate-limit');
```

- [ ] **Step 2: Define the limiter**

Below the CORS setup, before route handlers:

```js
const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,   // 1 minute
    max: 100,              // 100 requests per window per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' }
});
```

- [ ] **Step 3: Apply the limiter to `POST /api/webhook`**

Change:

```js
app.post('/api/webhook', async (req, res) => {
```

To:

```js
app.post('/api/webhook', webhookLimiter, async (req, res) => {
```

- [ ] **Step 4: Sanity check**

```bash
node --check server/index.cjs
```

- [ ] **Step 5: Smoke test the limiter is wired (not full rate-limit test)**

Start backend, send 1 valid POST, verify 200:

```bash
node --env-file=.env server/index.cjs &
BACKEND_PID=$!
sleep 1
SECRET=$(grep '^WEBHOOK_SECRET=' .env | cut -d= -f2)
curl -s -D - -X POST http://localhost:3001/api/webhook \
  -H "Content-Type: application/json" \
  -d "{\"secret\":\"$SECRET\",\"symbol\":\"BTCUSDT\",\"side\":\"BUY\",\"price\":65000,\"strategy\":\"test_task9\"}" | head -10
kill $BACKEND_PID
```

Expected in headers: `RateLimit-Limit: 100`, `RateLimit-Remaining: 99`, `RateLimit-Reset: 60`. If these headers are missing, the middleware is not attached.

- [ ] **Step 6: Commit**

```bash
git add server/index.cjs
git commit -m "feat(backend): add 100/min rate limit to webhook endpoint"
```

---

## Task 10: Backend — Bind to 127.0.0.1

**Files:**
- Modify: `server/index.cjs`

**Context:** The backend must listen only on `127.0.0.1`, not `0.0.0.0`. Caddy (port 443 → 3001) will proxy external traffic. Direct internet exposure of port 3001 bypasses Caddy and its HTTPS/security headers.

- [ ] **Step 1: Locate the `server.listen(...)` call**

Around line 184-188:

```js
const PORT = 3001;
server.listen(PORT, () => {
    console.log(`🚀 Webhook Server running on http://localhost:${PORT}`);
    console.log(`👉 Webhook Endpoint: http://localhost:${PORT}/api/webhook`);
});
```

- [ ] **Step 2: Replace with env-driven port and explicit 127.0.0.1 bind**

```js
const PORT = parseInt(process.env.PORT || '3001', 10);
server.listen(PORT, '127.0.0.1', () => {
    console.log(`🚀 Backend listening on http://127.0.0.1:${PORT}`);
    console.log(`👉 Webhook Endpoint: http://127.0.0.1:${PORT}/api/webhook`);
});
```

- [ ] **Step 3: Sanity check**

```bash
node --check server/index.cjs
```

- [ ] **Step 4: Run and verify bind**

```bash
node --env-file=.env server/index.cjs &
BACKEND_PID=$!
sleep 1
```

Expected log shows `127.0.0.1:3001`, not `0.0.0.0:3001`.

Verify via lsof:

```bash
lsof -nP -iTCP:3001 | head -5
```

Expected: one line with `127.0.0.1:3001` (not `*:3001`).

- [ ] **Step 5: Kill backend**

```bash
kill $BACKEND_PID
```

- [ ] **Step 6: Commit**

```bash
git add server/index.cjs
git commit -m "feat(backend): bind listener to 127.0.0.1 only (Caddy proxies external)"
```

---

## Task 11: Backend — `package.json` Scripts & Smoke Test

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update `package.json` scripts block**

Current (around line 6):

```json
"scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vite build",
    "preview": "vite preview"
},
```

Replace with:

```json
"scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vite build",
    "preview": "vite preview",
    "server": "node --env-file=.env server/index.cjs",
    "db:up": "docker compose --env-file .env up -d postgres",
    "db:down": "docker compose down",
    "db:logs": "docker compose logs -f postgres",
    "caddy": "caddy run --config Caddyfile"
},
```

Preserve valid JSON syntax — the trailing comma must be inside the object, not after it.

- [ ] **Step 2: Verify package.json parses**

```bash
node -e "JSON.parse(require('fs').readFileSync('./package.json','utf8'))" && echo "OK"
```

Expected: `OK`.

- [ ] **Step 3: Full backend smoke test**

```bash
# Ensure Postgres is up
npm run db:up
sleep 3
docker compose ps

# Start backend
npm run server &
BACKEND_PID=$!
sleep 1

# Smoke test 1: health
curl -s http://localhost:3001/health
echo

# Smoke test 2: no secret → 401
curl -s -o /dev/null -w "no-secret: %{http_code}\n" -X POST http://localhost:3001/api/webhook \
  -H "Content-Type: application/json" -d '{"symbol":"BTCUSDT","side":"BUY","price":100}'

# Smoke test 3: valid secret → 200
SECRET=$(grep '^WEBHOOK_SECRET=' .env | cut -d= -f2)
curl -s -o /dev/null -w "valid:     %{http_code}\n" -X POST http://localhost:3001/api/webhook \
  -H "Content-Type: application/json" \
  -d "{\"secret\":\"$SECRET\",\"symbol\":\"ETHUSDT\",\"side\":\"SELL\",\"price\":3200,\"strategy\":\"test_task11\"}"

# Smoke test 4: signals API returns the row
curl -s "http://localhost:3001/api/signals?limit=5" | head -200
echo

kill $BACKEND_PID
```

Expected output:
```
{"status":"ok","uptime":...}
no-secret: 401
valid:     200
[{"id":"wh_...","strategy":"test_task11","symbol":"ETHUSDT","side":"SELL","price":3200,...}]
```

- [ ] **Step 4: Verify Postgres state**

```bash
docker exec fidelio_postgres psql -U fidelio -d fidelio_signals \
  -c "SELECT strategy, COUNT(*) FROM signals GROUP BY strategy;"
```

Expected: rows for `test_task7`, `test_task9`, `test_task11` (accumulating from earlier smoke tests).

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "feat: add server/db/caddy npm scripts"
```

---

## Task 12: Frontend — `services/config.ts` + `.env.local`

**Files:**
- Create: `services/config.ts`
- Modify: `.env.local`

- [ ] **Step 1: Create `services/config.ts`**

Write the file with this exact content:

```ts
// Central backend URL config. Change VITE_BACKEND_URL in .env.local to
// point at the production webhook host (https://gumruc.com) or keep it
// on http://localhost:3001 for local dev against the laptop backend.
const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) || 'http://localhost:3001';

export const config = {
  backendUrl: BACKEND_URL,
  webhookUrl: `${BACKEND_URL}/api/webhook`,
  signalsUrl: `${BACKEND_URL}/api/signals`,
  forwardUrl: `${BACKEND_URL}/api/forward`,
  analyzeUrl: `${BACKEND_URL}/api/analyze`,
  healthUrl: `${BACKEND_URL}/health`,
  // socket.io-client upgrades http(s):// → ws(s):// automatically
  socketUrl: BACKEND_URL,
} as const;

export type AppConfig = typeof config;
```

- [ ] **Step 2: Check if `.env.local` exists**

```bash
ls -la .env.local 2>/dev/null && cat .env.local
```

If it doesn't exist, create it empty:

```bash
touch .env.local
```

- [ ] **Step 3: Add `VITE_BACKEND_URL` to `.env.local`**

Append (use Edit tool to avoid clobbering existing content):

```
VITE_BACKEND_URL=http://localhost:3001
```

- [ ] **Step 4: Verify `.env.local` is gitignored**

```bash
git check-ignore .env.local && echo "ignored OK"
```

Expected: `.env.local` printed + `ignored OK`. If not ignored, check `.gitignore` has `*.local` (it should, from the original repo setup).

- [ ] **Step 5: Type-check the new file**

```bash
npx tsc --noEmit
```

Expected: 0 errors for `services/config.ts`. If there are errors in OTHER files (pre-existing WIP), note them but don't fix here — we're only validating our new file compiles.

- [ ] **Step 6: Commit**

```bash
git add services/config.ts
git commit -m "feat(frontend): add services/config.ts — single source for backend URLs"
```

Note: `.env.local` is gitignored and is NOT committed.

---

## Task 13: Frontend — `context/SignalContext.tsx` URL Refactor

**Files:**
- Modify: `context/SignalContext.tsx`

**Context:** `context/SignalContext.tsx` is currently UNTRACKED (`??`) — this is the first commit of the file. We will add our changes on top of the user's untracked file and include the full file in our commit.

- [ ] **Step 1: Add `import { config }` near the top of the file**

Locate the existing `import { io } from 'socket.io-client';` line (line 2). Add below it:

```ts
import { config } from '../services/config';
```

- [ ] **Step 2: Replace the 4 hardcoded URLs**

| Find | Replace |
|---|---|
| `fetch('http://localhost:3001/api/forward', {` | `fetch(config.forwardUrl, {` |
| `io('http://localhost:3001', {` | `io(config.socketUrl, {` |
| `fetch('http://localhost:3001/api/signals')` | `fetch(config.signalsUrl)` |
| `fetch('http://localhost:3001/api/webhook', {` | `fetch(config.webhookUrl, {` |

Use the Edit tool for each one; the old strings are unique enough.

- [ ] **Step 3: Verify no more hardcoded references remain in this file**

```bash
grep -n "localhost:3001" context/SignalContext.tsx
```

Expected: no output (exit code 1).

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "(context/SignalContext|error)" | head -20
```

Expected: no errors related to `SignalContext.tsx`. Pre-existing errors in other files can remain.

- [ ] **Step 5: Commit**

```bash
git add context/SignalContext.tsx
git commit -m "refactor(frontend): SignalContext uses services/config for backend URLs"
```

---

## Task 14: Frontend — `services/aiService.ts` URL Refactor

**Files:**
- Modify: `services/aiService.ts`

- [ ] **Step 1: Add import**

At the top of the file, after existing imports (or as the first line if no imports):

```ts
import { config } from './config';
```

(Note: path is `./config` not `../services/config` because aiService.ts is in the same directory.)

- [ ] **Step 2: Replace the hardcoded URL**

Find (around line 29):
```ts
const response = await fetch('http://localhost:3001/api/analyze', {
```

Replace with:
```ts
const response = await fetch(config.analyzeUrl, {
```

- [ ] **Step 3: Verify clean**

```bash
grep -n "localhost:3001" services/aiService.ts
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add services/aiService.ts
git commit -m "refactor(frontend): aiService uses config.analyzeUrl"
```

---

## Task 15: Frontend — `components/SystemDiagnostics.tsx` URL Refactor

**Files:**
- Modify: `components/SystemDiagnostics.tsx`

**Context:** This file is untracked (`??`). First commit of the file.

- [ ] **Step 1: Add import**

Near the top, after React imports:

```ts
import { config } from '../services/config';
```

- [ ] **Step 2: Replace 5 references**

| Find | Replace |
|---|---|
| `fetch('http://localhost:3001/health')` | `fetch(config.healthUrl)` |
| `fetch('http://localhost:3001/api/signals')` | `fetch(config.signalsUrl)` |
| `fetch('http://localhost:3001/api/webhook', {` | `fetch(config.webhookUrl, {` |
| `fetch('http://localhost:3001/api/analyze', {` | `fetch(config.analyzeUrl, {` |

And for the display string on line ~252:

Find:
```tsx
OK: http://localhost:3001/health
```

Replace with:
```tsx
OK: {config.healthUrl}
```

Note: this is inside JSX text content — braces required.

- [ ] **Step 3: Verify**

```bash
grep -n "localhost:3001" components/SystemDiagnostics.tsx
```

Expected: no output.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "SystemDiagnostics" | head -10
```

Expected: no errors related to this file.

- [ ] **Step 5: Commit**

```bash
git add components/SystemDiagnostics.tsx
git commit -m "refactor(frontend): SystemDiagnostics uses services/config"
```

---

## Task 16: Frontend — `DatabaseViewer.tsx` + `NotificationSettingsPanel.tsx`

**Files:**
- Modify: `components/DatabaseViewer.tsx`
- Modify: `components/NotificationSettingsPanel.tsx`

- [ ] **Step 1: `DatabaseViewer.tsx` — add import**

At top:
```ts
import { config } from '../services/config';
```

- [ ] **Step 2: `DatabaseViewer.tsx` — replace 2 URLs**

| Find | Replace |
|---|---|
| `fetch('http://localhost:3001/api/signals')` | `fetch(config.signalsUrl)` |
| `fetch('http://localhost:3001/api/webhook', {` | `fetch(config.webhookUrl, {` |

- [ ] **Step 3: `DatabaseViewer.tsx` — verify clean**

```bash
grep -n "localhost:3001" components/DatabaseViewer.tsx
```

Expected: no output.

- [ ] **Step 4: `NotificationSettingsPanel.tsx` — add import**

```ts
import { config } from '../services/config';
```

- [ ] **Step 5: `NotificationSettingsPanel.tsx` — replace 1 URL**

| Find | Replace |
|---|---|
| `fetch('http://localhost:3001/api/forward', {` | `fetch(config.forwardUrl, {` |

- [ ] **Step 6: Verify both clean**

```bash
grep -n "localhost:3001" components/DatabaseViewer.tsx components/NotificationSettingsPanel.tsx
```

Expected: no output.

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "(DatabaseViewer|NotificationSettingsPanel)" | head -10
```

Expected: no errors in these files.

- [ ] **Step 8: Commit (one combined commit)**

```bash
git add components/DatabaseViewer.tsx components/NotificationSettingsPanel.tsx
git commit -m "refactor(frontend): DatabaseViewer + NotificationSettingsPanel use services/config"
```

---

## Task 17: Frontend — `WebhookManager.tsx` Bug Fixes (Ports + Display String)

**Files:**
- Modify: `components/WebhookManager.tsx`

**Context:** This file has pre-existing WIP modifications. Use `git add components/WebhookManager.tsx` after confirming the diff is only our changes (or accept that WIP is included — note in commit message if so).

- [ ] **Step 1: Add import**

At the top of the file (line 1 is `import React, { useState, useEffect } from 'react';`), add:

```ts
import { config } from '../services/config';
```

- [ ] **Step 2: Remove the bad `webhookUrl` and `secret` definitions**

Find (around line 83-85):

```tsx
    // Local Webhook URL
    const webhookUrl = `http://localhost:80/api/webhook`;
    const secret = `sk_live_${Math.random().toString(36).substring(2, 15)}`;
```

Replace with:

```tsx
    // Webhook URL — served from central config (spec §5.2)
    const webhookUrl = config.webhookUrl;
    // Secret is now user-managed via localStorage (see Task 18)
```

The `secret` const is deliberately removed here; Task 18 adds it back as a `useState` driven by localStorage.

**⚠️ Task 17 breaks the build temporarily** — the rest of the component still references `secret` (e.g., in `generateTemplateJSON` and `generateCustomJSON`). That's intentional: Task 18 adds the state back via `useState` and fixes those references.

**Required workflow:** **do Task 17 and Task 18 together as one commit**. Do not run `npx tsc --noEmit` or attempt to commit between 17 and 18. Proceed directly from Task 17 Step 5 to Task 18 Step 1 without intermediate verification.

- [ ] **Step 3: Fix the health check URL (line ~108)**

Find:
```tsx
            const response = await fetch('http://localhost:80/health', {
                method: 'GET',
                signal: AbortSignal.timeout(2000)
            });
```

Replace with:
```tsx
            const response = await fetch(config.healthUrl, {
                method: 'GET',
                signal: AbortSignal.timeout(2000)
            });
```

- [ ] **Step 4: Fix the display string for webhook URL (line ~358)**

Find:
```tsx
                                                <code className="text-sm text-purple-400 bg-black/30 px-2 py-1 rounded flex-1">
                                                    http://localhost:3001/api/webhook
                                                </code>
```

Replace with:
```tsx
                                                <code className="text-sm text-purple-400 bg-black/30 px-2 py-1 rounded flex-1">
                                                    {config.webhookUrl}
                                                </code>
```

- [ ] **Step 5: Verify no port-80 references remain**

```bash
grep -n "localhost:80" components/WebhookManager.tsx
grep -n "localhost:3001" components/WebhookManager.tsx
```

Expected: both empty.

- [ ] **Step 6: Do NOT commit yet** — combine with Task 18. Proceed directly to Task 18.

---

## Task 18: Frontend — WebhookManager Secret localStorage State + Input UI

**Files:**
- Modify: `components/WebhookManager.tsx`

- [ ] **Step 1: Add `secret` state from localStorage**

Inside the component, near the top with other `useState` calls (around line 73), add:

```tsx
    const [secret, setSecret] = useState<string>(() => {
        return localStorage.getItem('webhook_secret') || '';
    });

    const handleSecretChange = (newSecret: string) => {
        setSecret(newSecret);
        if (newSecret) {
            localStorage.setItem('webhook_secret', newSecret);
        } else {
            localStorage.removeItem('webhook_secret');
        }
    };
```

Place it with the other `useState` declarations (after `const [showQR, setShowQR] = useState(false);` or similar).

- [ ] **Step 2: Verify `generateTemplateJSON` and `generateCustomJSON` use this state**

These functions already reference `secret` (the variable we removed in Task 17). Now that `secret` is back as state, they should work without change. Verify by grepping:

```bash
grep -n "secret:" components/WebhookManager.tsx
```

Expected: 2+ matches inside `generateTemplateJSON` and `generateCustomJSON` bodies.

If the functions accidentally reference `secret` before definition (hoisting issue), ensure the state is declared earlier in the function body than the callbacks. React's functional component rules: declarations at the top, before any `return` or helper function definitions.

- [ ] **Step 3: Add the secret input UI — new block at the top of the render**

Find the opening `<div className="max-w-7xl mx-auto relative z-10">` (around line 259). Just BEFORE the `{/* Tabs */}` comment, add this new block:

```tsx
                {/* Secret Input — spec §5.5 */}
                <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-lg p-4 mb-6">
                    <label className="text-xs text-gray-400 flex items-center gap-2 font-medium mb-2">
                        <ShieldAlert size={12} />
                        Webhook Secret (backend .env WEBHOOK_SECRET ile aynı)
                    </label>
                    <input
                        type="password"
                        value={secret}
                        onChange={e => handleSecretChange(e.target.value)}
                        placeholder="sk_..."
                        autoComplete="off"
                        className="w-full bg-black/30 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 font-mono focus:border-purple-500/50 focus:outline-none"
                    />
                    {!secret && (
                        <p className="text-xs text-amber-400 mt-2">
                            ⚠️ Secret girilmeden template'ler ve manual test çalışmaz. Backend `.env`'ten kopyala.
                        </p>
                    )}
                </div>
```

`ShieldAlert` is already imported at the top of the file from `lucide-react`.

- [ ] **Step 4: Type-check the combined Task 17+18 state**

```bash
npx tsc --noEmit 2>&1 | grep "WebhookManager" | head -20
```

Expected: no errors referencing `WebhookManager.tsx`. If `secret` is "used before declaration" or "cannot find name secret" — move the `useState` block higher in the component body.

- [ ] **Step 5: Commit combined Task 17 + 18**

```bash
git add components/WebhookManager.tsx
git commit -m "fix+feat(WebhookManager): port 80→config urls; user-managed localStorage secret"
```

---

## Task 19: Frontend — WebhookManager `handleInject` POSTs to Backend

**Files:**
- Modify: `components/WebhookManager.tsx`

- [ ] **Step 1: Replace the `handleInject` function**

Find the current implementation (around line 155):

```tsx
    const handleInject = (e: React.FormEvent) => {
        e.preventDefault();
        if (!manualSymbol || !manualPrice) return;

        const signal: Signal = {
            id: `man_${Date.now()}`,
            strategy: manualStrategy,
            symbol: manualSymbol.toUpperCase().includes('USDT') ? manualSymbol.toUpperCase() : `${manualSymbol.toUpperCase()}USDT`,
            side: manualSide,
            price: parseFloat(manualPrice),
            time: new Date().toISOString(),
            note: 'Manually injected via Signal Hub',
            source: 'WEBHOOK',
            confidence: 0.99
        };

        onManualSignal(signal);
        setManualSymbol('');
        setManualPrice('');
    };
```

Replace with:

```tsx
    const handleInject = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!manualSymbol || !manualPrice) return;
        if (!secret) {
            alert('❌ Secret girilmedi. Yukarıdaki input\'a backend .env\'teki WEBHOOK_SECRET değerini yapıştır.');
            return;
        }

        const payload = {
            secret,
            id: `man_${Date.now()}`,
            strategy: manualStrategy,
            symbol: manualSymbol.toUpperCase().includes('USDT')
                ? manualSymbol.toUpperCase()
                : `${manualSymbol.toUpperCase()}USDT`,
            side: manualSide,
            price: parseFloat(manualPrice),
            time: new Date().toISOString(),
            note: 'Manually injected via Signal Hub',
            source: 'WEBHOOK',
            confidence: 0.99
        };

        try {
            const res = await fetch(config.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                setManualSymbol('');
                setManualPrice('');
                // socket.io echo updates UI; no local state push needed
            } else if (res.status === 401) {
                alert('❌ Secret yanlış — backend .env\'teki WEBHOOK_SECRET ile eşleşmiyor.');
            } else {
                alert(`❌ Hata: ${res.status}`);
            }
        } catch (err) {
            alert('❌ Bağlantı hatası — backend çalışıyor mu?');
        }
    };
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "WebhookManager" | head -20
```

Expected: 0 errors (the unused `Signal` type import may warn — that's OK, not an error).

- [ ] **Step 3: Commit**

```bash
git add components/WebhookManager.tsx
git commit -m "feat(WebhookManager): handleInject POSTs to backend with secret auth"
```

---

## Task 20: Frontend — WebhookManager `testWebhook` with Secret

**Files:**
- Modify: `components/WebhookManager.tsx`

- [ ] **Step 1: Replace the `testWebhook` function**

Find (around line 118):

```tsx
    const testWebhook = async () => {
        setTesting(true);
        try {
            const testSignal = {
                symbol: 'BTCUSDT',
                side: 'BUY',
                price: 65000,
                strategy: 'Webhook_Test',
                time: new Date().toISOString()
            };

            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(testSignal)
            });

            if (response.ok) {
                alert('✅ Test başarılı! Sinyal dashboard\'a gönderildi.');
                setServerStatus('ONLINE');
            } else {
                alert('⚠️ Sunucu yanıt verdi ama hata oluştu.');
            }
        } catch (e) {
            alert('❌ Bağlantı hatası! Sunucu çalışmıyor olabilir.');
            setServerStatus('OFFLINE');
        } finally {
            setTesting(false);
        }
    };
```

Replace with:

```tsx
    const testWebhook = async () => {
        if (!secret) {
            alert('❌ Secret girilmedi. Yukarıdaki input\'a backend .env\'teki WEBHOOK_SECRET değerini yapıştır.');
            return;
        }
        setTesting(true);
        try {
            const testPayload = {
                secret,
                symbol: 'BTCUSDT',
                side: 'BUY',
                price: 65000,
                strategy: 'Webhook_Test',
                time: new Date().toISOString()
            };

            const response = await fetch(config.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(testPayload)
            });

            if (response.ok) {
                alert('✅ Test başarılı! Sinyal dashboard\'a gönderildi.');
                setServerStatus('ONLINE');
            } else if (response.status === 401) {
                alert('❌ Secret yanlış — backend .env ile eşleşmiyor.');
            } else {
                alert(`⚠️ Sunucu hata döndü: ${response.status}`);
            }
        } catch (e) {
            alert('❌ Bağlantı hatası! Sunucu çalışmıyor olabilir.');
            setServerStatus('OFFLINE');
        } finally {
            setTesting(false);
        }
    };
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "WebhookManager" | head -20
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add components/WebhookManager.tsx
git commit -m "feat(WebhookManager): testWebhook includes secret in payload"
```

---

## Task 21: Frontend — Remove `onManualSignal` Prop

**Files:**
- Modify: `components/WebhookManager.tsx`

- [ ] **Step 1: Update the `WebhookManagerProps` interface**

Find (around line 7):

```tsx
interface WebhookManagerProps {
    onManualSignal: (signal: Signal) => void;
}
```

Change to:

```tsx
// Component is self-contained — no props needed. Manual inject POSTs to
// backend and relies on socket.io echo for UI updates.
```

(Delete the interface entirely — it has no other members.)

- [ ] **Step 2: Update component signature**

Find (around line 71):

```tsx
export const WebhookManager: React.FC<WebhookManagerProps> = ({ onManualSignal }) => {
```

Change to:

```tsx
export const WebhookManager: React.FC = () => {
```

- [ ] **Step 3: Remove `Signal` import if unused**

Check:
```bash
grep -n "Signal[^a-zA-Z]" components/WebhookManager.tsx
```

If `Signal` is only in the import line and nowhere else, update the import:

```tsx
import { Signal, Side } from '../types';
```

To:

```tsx
import { Side } from '../types';
```

- [ ] **Step 4: Audit `onManualSignal` usage outside this file**

```bash
grep -rn "onManualSignal" --include="*.tsx" --include="*.ts"
```

Expected: 0 matches (we just deleted the only reference). If other files reference it, update them to not pass the prop.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "WebhookManager" | head -20
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add components/WebhookManager.tsx
git commit -m "refactor(WebhookManager): remove onManualSignal prop — self-contained"
```

---

## Task 22: Frontend — Render WebhookManager in App.tsx

**Files:**
- Modify: `App.tsx`
- Possibly modify: `context/UserContext.tsx` (if `viewMode` is a strict union type)

**Context:** `WebhookManager` is imported at `App.tsx:10` but never rendered. We add a new view mode `'webhook'`, a nav link, and a conditional render block.

- [ ] **Step 1: Check if `viewMode` is a strict union type**

```bash
grep -n "viewMode" context/UserContext.tsx | head -20
```

Find the type declaration. If it's something like:

```ts
viewMode: 'dashboard' | 'spot-scanner' | 'funding' | ...;
```

then you need to add `'webhook'` to the union (next sub-step). If it's typed as `string`, no type change needed.

- [ ] **Step 2: Add `'webhook'` to viewMode union (if applicable)**

If strict union exists, edit `context/UserContext.tsx` to add `'webhook'` to the union. Example find:

```ts
type ViewMode = 'dashboard' | 'spot-scanner' | 'funding' | 'radar' | 'portfolio' | 'signals-manager' | 'fidelio-ai' | 'journal' | 'database' | 'nexus' | 'lab';
```

Add to the end (before the closing `;`):

```ts
type ViewMode = 'dashboard' | 'spot-scanner' | 'funding' | 'radar' | 'portfolio' | 'signals-manager' | 'fidelio-ai' | 'journal' | 'database' | 'nexus' | 'lab' | 'webhook';
```

If no union exists (just `string`), skip this step.

- [ ] **Step 3: Import `Terminal` icon in `App.tsx`**

Find (around line 17):
```tsx
import { Settings, Moon, Sun, Hexagon, Sparkles, LayoutGrid, Palette, LogOut, Building2, LayoutDashboard, Activity, Wallet, Radar, FlaskConical, Bitcoin, Database, FlaskRound } from 'lucide-react';
```

Add `Terminal` to the import list:

```tsx
import { Settings, Moon, Sun, Hexagon, Sparkles, LayoutGrid, Palette, LogOut, Building2, LayoutDashboard, Activity, Wallet, Radar, FlaskConical, Bitcoin, Database, FlaskRound, Terminal } from 'lucide-react';
```

- [ ] **Step 4: Add a NavLink in the header nav**

Find (around line 230):

```tsx
                            <NavLink mode="signals-manager" label={t.signals} />

                            <NavLink mode="nexus" label={t.nexus} icon={<Activity size={14} />} />
```

Insert a new NavLink between `signals-manager` and `nexus`:

```tsx
                            <NavLink mode="signals-manager" label={t.signals} />
                            <NavLink mode="webhook" label="Webhook" icon={<Terminal size={14} />} />

                            <NavLink mode="nexus" label={t.nexus} icon={<Activity size={14} />} />
```

(Hardcoded label "Webhook" — adding to `translations.ts` is optional scope-creep. Plain string is fine.)

- [ ] **Step 5: Add the render block for WebhookManager**

Find (around line 345):

```tsx
                        {viewMode === 'lab' && <SystemDiagnostics />}
                        {viewMode === 'database' && <DatabaseViewer />}
                        {viewMode === 'nexus' && <NexusDashboard />}
```

Insert the webhook render line:

```tsx
                        {viewMode === 'lab' && <SystemDiagnostics />}
                        {viewMode === 'database' && <DatabaseViewer />}
                        {viewMode === 'webhook' && <WebhookManager />}
                        {viewMode === 'nexus' && <NexusDashboard />}
```

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "(App\.tsx|UserContext)" | head -20
```

Expected: 0 errors in `App.tsx` and `context/UserContext.tsx`. If `Type 'string' is not assignable to type 'ViewMode'` appears, go back to Step 2 and update the union type.

- [ ] **Step 7: Commit**

```bash
git add App.tsx context/UserContext.tsx
git commit -m "feat(frontend): render WebhookManager as new 'webhook' view in App.tsx"
```

(If `UserContext.tsx` wasn't modified, just `git add App.tsx`.)

---

## Task 23: Frontend Integration Smoke Test (Browser)

**Context:** All frontend code changes are done. Run the dev server and manually test the webhook flow end-to-end (frontend ↔ local backend ↔ Postgres).

**Files:**
- None (runtime verification)

- [ ] **Step 1: Ensure backend is running**

```bash
# Postgres
docker compose ps
# If not up:
npm run db:up

# Backend
pgrep -f "node.*server/index.cjs" >/dev/null || (npm run server &)
sleep 1
curl -s http://localhost:3001/health
```

Expected: `{"status":"ok","uptime":...}`.

- [ ] **Step 2: Start frontend dev server**

If not already running:
```bash
npm run dev
```

Expected: Vite outputs `Local: http://localhost:3000/`.

- [ ] **Step 3: Browser test checklist**

Open http://localhost:3000 in a browser. Log in if the landing page appears.

- [ ] Click the "Webhook" nav link in the header (with Terminal icon)
- [ ] The WebhookManager UI appears (purple/violet gradient, "Webhook Creator Studio" header)
- [ ] Server Status badge shows "ONLINE" (green dot)
- [ ] An amber warning appears in the Secret input block: "Secret girilmeden template'ler ve manual test çalışmaz."
- [ ] Paste the `WEBHOOK_SECRET` value from `.env` into the secret input
- [ ] The amber warning disappears
- [ ] Refresh the page — the secret persists (localStorage)
- [ ] Click "Manual Test" tab
- [ ] Fill Symbol=`BTCUSDT`, Price=`50000`, Side=`BUY`
- [ ] Click "Inject Signal"
- [ ] Form clears (no alert pops up) — success
- [ ] Navigate to "Signals" or "Database" view — the test signal is visible

- [ ] **Step 4: Verify signal in Postgres**

```bash
docker exec fidelio_postgres psql -U fidelio -d fidelio_signals \
  -c "SELECT id,symbol,side,price,strategy FROM signals WHERE strategy='Manual_Override' ORDER BY received_at DESC LIMIT 5;"
```

Expected: rows for the manual tests you just did.

- [ ] **Step 5: Verify socket broadcast works across tabs**

- [ ] Open a second tab at http://localhost:3000
- [ ] Log in
- [ ] Trigger another manual inject from the first tab
- [ ] The second tab's Signal Feed / Database view shows the new signal without a refresh (within ~1 second)

This confirms socket.io broadcast is working.

- [ ] **Step 6: Stop dev server**

```bash
# Ctrl+C in the terminal running npm run dev
# Or if backgrounded:
pkill -f "vite"
```

- [ ] **Step 7: No commit** — this is verification only.

---

## Task 24: Full TypeScript Type Check

**Context:** Before moving to deployment, confirm the entire codebase (our changes + pre-existing WIP that isn't ours) doesn't have new type errors introduced by our refactor.

- [ ] **Step 1: Run full type check**

```bash
npx tsc --noEmit 2>&1 | tee /tmp/tsc-output.txt
```

- [ ] **Step 2: Classify errors**

Look at `/tmp/tsc-output.txt`. For each error, classify as:
- **NEW (introduced by our work)** — must fix before proceeding
- **PRE-EXISTING (in files we didn't touch)** — NOT our concern, note and move on

Quick filter for files we modified:
```bash
grep -E "(services/config\.ts|services/aiService\.ts|context/SignalContext\.tsx|context/UserContext\.tsx|components/WebhookManager\.tsx|components/SystemDiagnostics\.tsx|components/DatabaseViewer\.tsx|components/NotificationSettingsPanel\.tsx|App\.tsx)" /tmp/tsc-output.txt
```

Expected: 0 matches for files we modified. If there are matches, fix them before continuing.

- [ ] **Step 3: If fixes made, commit**

```bash
git add <fixed files>
git commit -m "fix: type errors surfaced during Task 24 type check"
```

- [ ] **Step 4: If no fixes needed, no commit. Move on.**

---

## Task 25: Network — Public IP (CGNAT) Verification

**Context:** Before touching DNS / port forward, confirm the laptop has a genuine public IP. If CGNAT is detected, the port-forward path is impossible and we switch to the Cloudflare Tunnel fallback (spec Section 3.4).

- [ ] **Step 1: Get the public IP as seen from the internet**

```bash
curl -s ifconfig.me
echo
```

Expected: a single IPv4 address (e.g. `78.162.x.y`). Note it.

- [ ] **Step 2: Get the modem's WAN IP from the router admin panel**

Open a browser and navigate to the router admin page:
- Try `http://192.168.1.1`
- If not there, try `http://192.168.0.1`
- If not there, check the sticker on the modem itself

Log in (credentials usually on the sticker too). Navigate to **Status** / **Internet** / **WAN** — find the **WAN IP** or **Public IP** or **IPv4 Address**. Note it.

- [ ] **Step 3: Compare**

| ifconfig.me | Router WAN | Same? |
|---|---|---|
| `...` | `...` | Y / N |

- **If same ✅** — genuine public IP, continue to Task 26.
- **If different ❌** — CGNAT. **STOP port-forward path. Switch to Cloudflare Tunnel fallback:**
    - Skip Tasks 26, 27, 29, 30.
    - Follow an abbreviated Cloudflare Tunnel setup (separate sub-plan):
        1. `brew install cloudflared`
        2. Cloudflare dashboard → add `gumruc.com` zone → update nameservers at registrar (24h propagation)
        3. `cloudflared tunnel login`
        4. `cloudflared tunnel create fidelio`
        5. Create `~/.cloudflared/config.yml`:
           ```yaml
           tunnel: <tunnel-id>
           credentials-file: /Users/mertaysune/.cloudflared/<tunnel-id>.json
           ingress:
             - hostname: gumruc.com
               service: http://localhost:3001
             - service: http_status:404
           ```
        6. `cloudflared tunnel route dns fidelio gumruc.com`
        7. `sudo cloudflared service install`
        8. Skip Caddy (Tasks 29-30) — Cloudflare terminates TLS at the edge.
        9. Continue with Task 31 (launchd backend) and Task 32 (Docker start on login).

This fallback plan is a summary — full detailed steps are out of scope for this primary plan. If CGNAT is detected, report back with the comparison and we'll expand the fallback into a full task list.

- [ ] **Step 4: Record the outcome (no commit — infrastructure decision)**

Write down in a sticky note:
- Path chosen: **port forward** / **Cloudflare Tunnel**
- Public IP: `x.x.x.x` (for port forward path)

---

## Task 26: Network — DNS A Records

**Context:** Only proceed if Task 25 confirmed genuine public IP.

**Files:**
- None (external DNS configuration)

- [ ] **Step 1: Log in to the domain registrar for `gumruc.com`**

The registrar is whatever panel the user uses (Natro, isimtescil, GoDaddy, Namecheap, Cloudflare, etc.). Navigate to **DNS Management** / **DNS Records**.

- [ ] **Step 2: Add two A records**

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | `<MODEM_PUBLIC_IP>` | 3600 |
| A | `www` | `<MODEM_PUBLIC_IP>` | 3600 |

`@` is shorthand for the apex domain (`gumruc.com`). Some panels use blank for apex. Use whatever the panel expects.

Delete any pre-existing A records for `@` or `www` that point elsewhere (parking page, old deploy) — they would conflict.

- [ ] **Step 3: Save and wait for propagation**

DNS propagation is typically 5–30 minutes but can take up to 24 hours. Poll with:

```bash
dig gumruc.com +short
dig www.gumruc.com +short
```

Expected: both commands return the modem public IP. If they return something else or nothing, wait and retry.

- [ ] **Step 4: Test from an external network (phone on cellular)**

This is the important one — dig from your laptop might use cached DNS or ISP DNS. Test from your phone's mobile data:

- Use a site like https://dnschecker.org/ with `gumruc.com` A record check
- OR open the phone's browser and hit `http://gumruc.com` (will fail with "connection refused" since Caddy isn't running yet — that's fine, DNS resolved)

Expected: the IP shown matches the modem WAN IP.

- [ ] **Step 5: No commit** — DNS is external, not versioned in the repo.

---

## Task 27: Network — Router Port Forward + DHCP Reservation

**Context:** Forward public ports 443 and 80 to the laptop's LAN IP on the same ports. Port 80 is required for Let's Encrypt HTTP-01 challenge during certificate issuance.

**Files:**
- None (external router configuration)

- [ ] **Step 1: Get the laptop's LAN IP**

```bash
ipconfig getifaddr en0
# If en0 is Wi-Fi and not active, try en1 (Ethernet) or:
# networksetup -listallhardwareports
```

Expected: a LAN IP like `192.168.1.x`. Note it.

- [ ] **Step 2: Get the laptop's MAC address**

```bash
ifconfig en0 | awk '/ether/ {print $2}'
```

Expected: 6 hex pairs like `aa:bb:cc:dd:ee:ff`. Note it.

- [ ] **Step 3: In router admin panel — create DHCP Reservation**

Navigate to **LAN** / **DHCP** / **DHCP Reservation** (exact name varies). Add:
- MAC: `<laptop-mac-from-step-2>`
- IP: `<laptop-lan-ip-from-step-1>` (or pick a fixed one from your LAN subnet)
- Name/Hostname: `fidelio-laptop` (optional)

This ensures the laptop always gets the same LAN IP. Without this, after a router reboot the LAN IP might change and break port forward.

- [ ] **Step 4: In router admin panel — create Port Forward rules**

Navigate to **Port Forwarding** / **Virtual Server** / **NAT Forwarding**. Add TWO rules:

**Rule 1 — HTTPS:**
| Field | Value |
|---|---|
| Service Name | `fidelio-https` |
| External Port | `443` |
| Internal IP | `<laptop-lan-ip>` |
| Internal Port | `443` |
| Protocol | `TCP` |
| Enabled | Yes |

**Rule 2 — HTTP (ACME):**
| Field | Value |
|---|---|
| Service Name | `fidelio-acme` |
| External Port | `80` |
| Internal IP | `<laptop-lan-ip>` |
| Internal Port | `80` |
| Protocol | `TCP` |
| Enabled | Yes |

Save and reboot the router if prompted.

- [ ] **Step 5: Verify port forward from external network**

From a machine NOT on the same LAN (e.g. phone on mobile data, or a cloud VM):

```bash
# Port 443 connectivity (Caddy not yet running, so expect connection refused)
nc -zv -w 5 <modem_public_ip> 443
nc -zv -w 5 <modem_public_ip> 80
```

Expected: either `succeeded` (if something is listening — Caddy isn't yet, so probably) or `Connection refused` (meaning the packet reached the laptop and nothing is listening — which is correct for now). If you get `timeout`, port forward didn't work — revisit router rules.

Alternative: use an online port checker:
- https://www.yougetsignal.com/tools/open-ports/ → enter public IP + 443 + check

- [ ] **Step 6: No commit** — router config is external.

---

## Task 28: System — macOS Sleep & Power Settings

**Files:**
- None (system settings)

- [ ] **Step 1: Verify macOS version**

```bash
sw_vers -productVersion
```

Note it. These commands work on macOS 10.12+ (Sierra and later).

- [ ] **Step 2: Apply power settings for AC (plugged-in)**

```bash
sudo pmset -c sleep 0
sudo pmset -c disksleep 0
sudo pmset -c powernap 0
sudo pmset -c displaysleep 15
```

`-c` scopes to charger (AC) mode. The display can still sleep after 15 minutes, but the system stays awake.

- [ ] **Step 3: Keep running when laptop lid closes (optional but recommended)**

```bash
sudo pmset -c lidwake 1
```

For true lid-closed operation, the laptop needs to also be plugged in and have an external display (or use `caffeinate` as a shim — see Step 4).

- [ ] **Step 4: Install a caffeinate auto-starter (optional, paranoia belt)**

For extra certainty the system never sleeps, create a launchd agent that runs `caffeinate -s` in the background:

```bash
cat > ~/Library/LaunchAgents/com.fidelio.caffeinate.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.fidelio.caffeinate</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/caffeinate</string>
        <string>-s</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
</dict>
</plist>
PLIST

launchctl load ~/Library/LaunchAgents/com.fidelio.caffeinate.plist
```

Verify:
```bash
launchctl list | grep fidelio.caffeinate
```

Expected: one row with `-` (not exited) status.

- [ ] **Step 5: Verify settings**

```bash
pmset -g | grep -E "^(sleep|disksleep|powernap|displaysleep)"
```

Expected (AC mode):
```
 sleep                0
 disksleep            0
 powernap             0
 displaysleep         15
```

- [ ] **Step 6: No commit** — system settings are external.

---

## Task 29: Install Caddy + Write Caddyfile

**Files:**
- Create: `Caddyfile`

- [ ] **Step 1: Install Caddy**

```bash
brew install caddy
caddy version
```

Expected: a version string like `v2.x.x`.

- [ ] **Step 2: Create `Caddyfile` at repo root**

Write the file with this exact content:

```
# Caddyfile — Webhook backend HTTPS reverse proxy
# spec: docs/superpowers/specs/2026-04-11-webhook-connection-design.md §6.3

gumruc.com, www.gumruc.com {
    # Automatic Let's Encrypt — Caddy handles ACME HTTP-01 via port 80
    # (make sure router forwards both 80 and 443 to this laptop)

    # Reverse proxy to the Node backend (bound on 127.0.0.1:3001)
    reverse_proxy localhost:3001

    # Security headers
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    # JSON access log — rotated at 10 MB, 5 files retained
    log {
        output file /usr/local/var/log/caddy/gumruc.log {
            roll_size 10mb
            roll_keep 5
        }
        format json
    }
}
```

- [ ] **Step 3: Validate Caddyfile syntax**

```bash
caddy fmt --overwrite Caddyfile
caddy validate --config Caddyfile
```

Expected output: `Valid configuration`. If not, the error message will tell you which line to fix.

- [ ] **Step 4: Create log directory**

```bash
sudo mkdir -p /usr/local/var/log/caddy
sudo chown $(whoami):staff /usr/local/var/log/caddy
```

- [ ] **Step 5: Commit Caddyfile**

```bash
git add Caddyfile
git commit -m "feat(deploy): Caddyfile for gumruc.com HTTPS reverse proxy"
```

---

## Task 30: First Caddy Run — Let's Encrypt Certificate

**Files:**
- None (runtime)

**Context:** First run — Caddy will perform an ACME HTTP-01 challenge on port 80, then serve HTTPS on port 443. This requires DNS + port forwards to be active (Tasks 26, 27).

- [ ] **Step 1: Ensure ports 80 and 443 are free on the laptop**

```bash
sudo lsof -nP -iTCP:80 -sTCP:LISTEN
sudo lsof -nP -iTCP:443 -sTCP:LISTEN
```

Expected: empty output (no process listening). If something is using port 80 (e.g., an old web server), stop it first.

- [ ] **Step 2: Ensure backend is running (so the reverse_proxy target is up)**

```bash
curl -s http://127.0.0.1:3001/health
```

Expected: `{"status":"ok",...}`. If empty, start: `npm run server &`.

- [ ] **Step 3: Run Caddy in foreground to watch the ACME challenge**

```bash
sudo caddy run --config Caddyfile
```

Expected log sequence (over 10–30 seconds):
1. `provisioning module {"module": "tls.issuance.acme"}`
2. `waiting on internal rate limiter`
3. `obtaining certificate` with `identifiers: gumruc.com, www.gumruc.com`
4. `certificate obtained successfully`
5. `serving initial configuration`

**Common failure modes:**
- `could not solve HTTP-01 challenge` → port 80 not reachable from internet. Test `nc -zv <public_ip> 80` from a phone. Fix router port forward.
- `DNS problem: NXDOMAIN looking up A for gumruc.com` → DNS not propagated yet. Wait 10 minutes and retry.
- `too many registrations for this IP` → Let's Encrypt rate limit. Use `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory` in Caddyfile `tls` block for testing, then switch back to production.

- [ ] **Step 4: Leave Caddy running. Open a new terminal and test from localhost**

```bash
curl -v https://gumruc.com/health
```

Expected: 200 + `{"status":"ok",...}`. Should show `subject: CN=gumruc.com` and `issuer: CN=R3, O=Let's Encrypt`.

- [ ] **Step 5: Test from external network (phone mobile data)**

Open https://gumruc.com/health on your phone over mobile data. Expected: JSON health response, valid certificate (no browser warning).

- [ ] **Step 6: Test webhook endpoint from external**

From the same external device:

```bash
# Load this in a terminal on the external device, or use curl on the phone via Termux:
SECRET=<paste from .env>
curl -X POST https://gumruc.com/api/webhook \
  -H "Content-Type: application/json" \
  -d "{\"secret\":\"$SECRET\",\"symbol\":\"BTCUSDT\",\"side\":\"BUY\",\"price\":65000,\"strategy\":\"test_task30\"}"
```

Expected: `{"success":true,"signalId":"wh_..."}`.

- [ ] **Step 7: Verify the signal reached Postgres**

On the laptop:
```bash
docker exec fidelio_postgres psql -U fidelio -d fidelio_signals \
  -c "SELECT id,strategy,symbol FROM signals WHERE strategy='test_task30';"
```

Expected: 1 row.

- [ ] **Step 8: Stop the foreground Caddy (Ctrl+C in its terminal)**

We'll restart it as a service in Task 31.

- [ ] **Step 9: No commit — this is runtime verification.**

---

## Task 31: Persistent Services — launchd Backend + brew services Caddy

**Files:**
- Create: `~/Library/LaunchAgents/com.fidelio.backend.plist` (external, not in repo)

- [ ] **Step 1: Create log directory for backend**

```bash
sudo mkdir -p /usr/local/var/log/fidelio
sudo chown $(whoami):staff /usr/local/var/log/fidelio
```

- [ ] **Step 2: Find the absolute path to Node**

```bash
which node
```

Expected: `/opt/homebrew/bin/node` (Apple Silicon) or `/usr/local/bin/node` (Intel). Use whatever is returned in the next step.

- [ ] **Step 3: Write the launchd plist**

Write `~/Library/LaunchAgents/com.fidelio.backend.plist` with this content (replace `/opt/homebrew/bin/node` with the path from Step 2 if different):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.fidelio.backend</string>
    <key>WorkingDirectory</key>
    <string>/Users/mertaysune/fidelioai/FidelioAI</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>--env-file=.env</string>
        <string>server/index.cjs</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/usr/local/var/log/fidelio/backend.log</string>
    <key>StandardErrorPath</key>
    <string>/usr/local/var/log/fidelio/backend.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
```

- [ ] **Step 4: Stop any existing backend process**

```bash
pkill -f "node.*server/index.cjs" 2>/dev/null
sleep 1
lsof -nP -iTCP:3001 -sTCP:LISTEN || echo "port 3001 free"
```

Expected: `port 3001 free`.

- [ ] **Step 5: Load the launchd agent**

```bash
launchctl load ~/Library/LaunchAgents/com.fidelio.backend.plist
sleep 2
launchctl list | grep com.fidelio.backend
```

Expected: one line showing the agent (PID column populated means it's running).

- [ ] **Step 6: Verify backend is reachable**

```bash
curl -s http://127.0.0.1:3001/health
```

Expected: JSON health response.

- [ ] **Step 7: Inspect logs**

```bash
tail -20 /usr/local/var/log/fidelio/backend.log
tail -20 /usr/local/var/log/fidelio/backend.err.log
```

Expected: backend startup messages in the main log; no entries (or just warnings) in the err log.

- [ ] **Step 8: Copy Caddyfile to the brew services location**

```bash
sudo cp Caddyfile /opt/homebrew/etc/Caddyfile
sudo chown $(whoami):staff /opt/homebrew/etc/Caddyfile
```

(Intel Macs: path is `/usr/local/etc/Caddyfile`.)

- [ ] **Step 9: Start Caddy as a service**

```bash
sudo brew services start caddy
sleep 3
brew services list | grep caddy
```

Expected: `caddy started`.

- [ ] **Step 10: Verify HTTPS still works**

```bash
curl -s https://gumruc.com/health
```

Expected: `{"status":"ok",...}`.

- [ ] **Step 11: Reboot test (optional but recommended)**

Reboot the laptop:

```bash
sudo shutdown -r now
```

After boot, log in. Do NOT start anything manually. Wait 60 seconds. Then:

```bash
launchctl list | grep fidelio
brew services list | grep caddy
docker compose ps
curl -s http://127.0.0.1:3001/health
curl -s https://gumruc.com/health
```

Expected: backend agent running, Caddy started, Postgres up, both health endpoints responding. If anything fails, check logs and fix before moving on.

- [ ] **Step 12: No commit — plist and services config are system-level, not repo.**

---

## Task 32: Docker Desktop Start-on-Login

**Files:**
- None (Docker Desktop settings)

- [ ] **Step 1: Open Docker Desktop settings**

- Click the Docker Desktop menu bar icon
- Choose **Settings** (or **Preferences** on older versions)
- Go to **General**
- Enable **"Start Docker Desktop when you sign in"**
- Click **Apply & Restart**

- [ ] **Step 2: Verify on next reboot**

(Already covered by the optional reboot test in Task 31 Step 11.)

- [ ] **Step 3: No commit.**

---

## Task 33: TradingView Alert Configuration + E2E Test

**Files:**
- None (TradingView web UI)

**Context:** This is the final E2E test. A real TradingView alert fires, hits the public webhook, reaches the backend, inserts to Postgres, broadcasts via socket.io, and appears in the frontend.

- [ ] **Step 1: Open TradingView and log in**

https://www.tradingview.com/ — ensure your plan has webhook alerts (Essential or above).

- [ ] **Step 2: Open a chart (e.g. BTCUSDT 1m on Binance)**

- [ ] **Step 3: Create a new alert**

- Click the alarm icon (top toolbar)
- Or press `Alt+A`

Configure:
- **Condition:** Pick anything that will trigger easily — e.g. `BTCUSDT Crosses` → `Moving Average (9)`. Or use "Price" → "Crossing" → some value near current price.
- **Trigger:** Only Once (so it doesn't spam)
- **Expiration:** Open-ended or a future time
- **Alert name:** `Fidelio webhook smoke test`

- [ ] **Step 4: Configure Notifications tab**

- **Webhook URL:** `https://gumruc.com/api/webhook`
- **Message (JSON):**

```json
{
  "secret": "<PASTE-YOUR-WEBHOOK_SECRET-FROM-.ENV>",
  "symbol": "{{ticker}}",
  "side": "BUY",
  "price": "{{close}}",
  "strategy": "tv_alert_smoke",
  "time": "{{time}}"
}
```

**Replace** `<PASTE-YOUR-WEBHOOK_SECRET-FROM-.ENV>` with the actual secret string (no angle brackets). You can get it from the WebhookManager secret input in the frontend (it's stored in localStorage), or from `.env` on the laptop.

- [ ] **Step 5: Fire the test notification**

In the alert dialog, find the **"Test notification"** or similar button (some TradingView versions bury this — you may need to create the alert first, then open it and find the test button in the overflow menu). Click it.

- [ ] **Step 6: Watch for the signal on three layers**

On the laptop, in parallel terminals:

**Terminal A — Caddy access log:**
```bash
tail -f /usr/local/var/log/caddy/gumruc.log | grep webhook
```

Expected: a JSON log line within 5 seconds of clicking "Test notification" in TradingView, with `"status": 200`.

**Terminal B — Backend log:**
```bash
tail -f /usr/local/var/log/fidelio/backend.log
```

Expected: `Webhook received: { secret: ..., symbol: 'BTCUSDT', side: 'BUY', price: ..., strategy: 'tv_alert_smoke', ... }`.

**Terminal C — Postgres:**
```bash
watch -n 1 "docker exec fidelio_postgres psql -U fidelio -d fidelio_signals -c \"SELECT id,symbol,strategy,time FROM signals WHERE strategy='tv_alert_smoke' ORDER BY received_at DESC LIMIT 5;\""
```

Expected: a new row appears within a few seconds.

**Browser (frontend):**
Open http://localhost:3000 → Signals / Database view. A new signal appears within <10 seconds of the TradingView test fire.

- [ ] **Step 7: Measure end-to-end latency**

Record:
- Time TradingView "Test notification" clicked: `T0`
- Time signal appeared in frontend: `T1`
- Latency = `T1 - T0`

Target: **<10 seconds**. If >10s, investigate:
- Caddy log timestamp → if big gap from T0, DNS/edge delay
- Backend log timestamp → if big gap from Caddy, network between edge and laptop
- Postgres row `received_at` → if big gap from backend log, DB slow
- Socket.io broadcast → if DB insert is fast but frontend is slow, WebSocket connection issue

- [ ] **Step 8: Disable the test alert in TradingView (so it doesn't keep firing)**

- [ ] **Step 9: No commit — this is runtime verification.**

---

## Task 34: Success Criteria Checklist

**Context:** Walk through the spec's Section 11 success criteria and verify each one. Record the outcome.

**Files:**
- None (verification)

- [ ] **Step 1: Run through each criterion**

- [ ] TradingView test alert → local frontend gecikmesi **<10 saniye** (measured in Task 33)
- [ ] Secret'sız POST → 401 (verified in Task 7)
- [ ] Laptop reboot → tüm servisler otomatik kalkıyor (verified in Task 31 Step 11)
- [ ] `docker compose down && up` → eski sinyaller Postgres'te hâlâ var
   ```bash
   npm run db:down
   npm run db:up
   sleep 5
   docker exec fidelio_postgres psql -U fidelio -d fidelio_signals \
     -c "SELECT COUNT(*) FROM signals;"
   ```
   Expected: COUNT > 0 (rows persist in `./postgres_data`).
- [ ] Signal Hub → secret yapıştır → template kopyala → TradingView akışı çalışıyor (verified in Task 23 + 33)
- [ ] Caddy Let's Encrypt sertifikası geçerli, expire > 60 gün
   ```bash
   curl -vI https://gumruc.com 2>&1 | grep -E "(subject|issuer|expire)"
   ```
   Expected: issuer Let's Encrypt, expiry date 60+ days from today.
- [ ] Aylık maliyet: $0 ✅

- [ ] **Step 2: Any failures? Document and fix**

If any box is unchecked, fix before proceeding. Go back to the relevant task and re-run.

- [ ] **Step 3: Commit a success marker (optional)**

```bash
# No file changes needed; success is runtime state. But if you want a
# historical marker on the branch:
git commit --allow-empty -m "test: all success criteria passed (task 34)"
```

---

## Task 35: Finishing — Merge Decision

**Files:**
- None (git workflow)

- [ ] **Step 1: Review the commit history on the feature branch**

```bash
git log main..HEAD --oneline
```

Expected: a list of commits from Tasks 1-22 (and optional 34). No WIP commits from the user's pre-existing unrelated changes (because we used targeted `git add`).

- [ ] **Step 2: Review the diff vs main**

```bash
git diff main --stat
```

Expected: only files we intended to modify:
- `.gitignore`
- `Caddyfile`
- `docker-compose.yml`
- `package.json`, `package-lock.json`
- `server/index.cjs`, `server/migrations/001_init.sql`
- `services/config.ts`, `services/aiService.ts`
- `context/SignalContext.tsx` (and maybe `context/UserContext.tsx`)
- `components/WebhookManager.tsx`, `components/SystemDiagnostics.tsx`, `components/DatabaseViewer.tsx`, `components/NotificationSettingsPanel.tsx`
- `App.tsx`
- `docs/superpowers/specs/2026-04-11-webhook-connection-design.md` (from earlier brainstorming — already on main)
- `docs/superpowers/plans/2026-04-11-webhook-connection.md` (this file)

If there are unrelated files (WIP files the user hasn't committed), they shouldn't be in the diff — we used targeted adds.

- [ ] **Step 3: Ask the user how to finish**

The brainstorming skill suggests the `superpowers:finishing-a-development-branch` skill can walk through merge options. Present the user:

- **A)** Merge to `main` fast-forward (if no conflicts): `git checkout main && git merge --ff-only feature/webhook-connection`
- **B)** Create a GitHub PR: `gh pr create --base main --title "..." --body "..."`
- **C)** Keep on feature branch for now, user will review and merge later
- **D)** Squash merge into a single commit: `git checkout main && git merge --squash feature/webhook-connection && git commit`

User picks.

- [ ] **Step 4: Execute chosen finishing action.**

---

## Self-Review Notes (for the plan author)

After writing this plan, spec coverage was verified against `docs/superpowers/specs/2026-04-11-webhook-connection-design.md`:

| Spec Section | Covered By |
|---|---|
| §1 Bağlam | (context only) |
| §2 Hedefler | Plan is scoped to these |
| §3 Mimari | Tasks 3, 5, 29, 30 |
| §4.1 .env | Task 4 |
| §4.2 Secret validation | Task 7 |
| §4.3 CORS | Task 8 |
| §4.4 Postgres migration | Tasks 3, 5, 6 |
| §4.5 Rate limit | Task 9 |
| §4.6 PORT 127.0.0.1 | Task 10 |
| §5.1 .env.local | Task 12 |
| §5.2 services/config.ts | Task 12 |
| §5.3 All file URL refactor | Tasks 13, 14, 15, 16, 17 |
| §5.4 WebhookManager bugs | Task 17 |
| §5.5 localStorage secret | Task 18 |
| §5.6 handleInject rewrite | Task 19 |
| §5.7 testWebhook | Task 20 |
| §5.8 App.tsx integration | Task 22 |
| §5.9 onManualSignal removal | Task 21 |
| §6.1 Tools install | Tasks 2, 29 (caddy), user pre-install (docker, node) |
| §6.2 docker-compose.yml | Task 3 |
| §6.3 Caddyfile | Task 29 |
| §6.4 package.json scripts | Task 11 |
| §6.5 Network kurulumu | Tasks 25, 26, 27, 28 |
| §6.6 Kalıcı servisler | Tasks 31, 32 |
| §6.7 TradingView alert | Task 33 |
| §7 Test planı | Tasks 5, 7, 8, 9, 11, 23, 30, 33 |
| §8 Monitoring | (runbook style — Task 34 spot check) |
| §9 Rollback | (documented in spec, plan-level rollback = `git reset`) |
| §10 Bilinen sınırlamalar | (spec-only, no task) |
| §11 Success criteria | Task 34 |
| §12 Out of scope | (explicitly skipped) |

**Gaps:** None — every in-scope requirement maps to a task.

**Placeholder scan:** No TODO/TBD/FIXME strings. All code blocks contain concrete commands and content.

**Type consistency:** `config` interface (Task 12) has the 6 URL fields used throughout Tasks 13–17. `loadSignals` async signature (Task 6) is consistent with its call sites (Task 6 Step 3). `WebhookManager` prop signature change (Task 21) matches the render in Task 22.
