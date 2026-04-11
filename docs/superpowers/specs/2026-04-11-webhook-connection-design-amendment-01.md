# Webhook Connection Design — Amendment 01

**Tarih:** 2026-04-11
**Parent spec:** `2026-04-11-webhook-connection-design.md`
**Durum:** Amendment — parent spec'in ilgili bölümlerinin yerini alır

## Değişiklik Sebepleri

Implementation sırasında keşfedilen üç realite:

1. **`origin/main` `e6311eb` commit'i (Hostinger MySQL production) canlı.** Orijinal spec "replace `server/index.cjs` with Postgres" yaklaşımı üretimi bozar. User konfirmasyonu: *"hostinger mysql hala geçerli"*.
2. **Deploy target macOS laptop değil, Windows 11 Home PC.** Orijinal spec launchd + brew services + pmset gibi macOS-spesifik mekanizmalar kullanıyordu.
3. **User Cloudflare Tunnel yerine port forward tercih etti** (`gumruc.com` DNS'i Hostinger'da kalıyor).

## Scope of Changes

Bu amendment şu bölümleri **supersede** eder:

- §3.1 Architecture — yeni veri akışı
- §3.4 Fallback plan — port forward **primary yol**, CF Tunnel acil fallback
- §4 (tüm bölüm) Backend Changes — **paralel dosya stratejisi**, `server/index.cjs`'e hiç dokunulmaz
- §5.1-5.3 Frontend URL refactor — `utils/config.ts` genişletilir, yeni `services/config.ts` yazılmaz
- §6.1-6.6 Deployment host — Windows 11 Home, Docker Compose, brew/launchd çıkarılır

Değişmeyen bölümler: §1, §2, §5.4 (WebhookManager secret bug), §5.5 (localStorage secret model), §5.6 (handleInject rewrite), §5.7 (testWebhook secret), §5.8 (App.tsx render), §5.9 (onManualSignal cleanup), §6.7 (TradingView alert), §7-12.

---

## Section A — Yeni Mimari (supersedes §3.1)

### Topoloji

```
TradingView Alert
     │
     │  HTTPS POST  {secret, symbol, side, price, strategy, time}
     ▼
https://gumruc.com/api/webhook
     │
     │  DNS A record (Hostinger DNS, dokunmuyor)
     │  → Ev modem public IP
     ▼
Ev Modem/Router
     │
     │  NAT port forward:
     │    443 TCP → windows_lan_ip:443  (HTTPS)
     │     80 TCP → windows_lan_ip:80   (Let's Encrypt HTTP-01)
     ▼
┌──────────────────────────────────────────────────┐
│  Windows 11 Home PC (dedicated, ev, 7/24 açık)   │
│  LAN IP: 192.168.0.22 (DHCP reservation ile sabit)│
│                                                  │
│  Docker Desktop (WSL2 backend)                   │
│    │                                             │
│    │  docker compose (fidelio_webhook.yml)       │
│    ▼                                             │
│  ┌────────────────────────────────────────────┐  │
│  │  Service 1: caddy                         │  │
│  │    - caddy:2-alpine                       │  │
│  │    - ports: 443:443, 80:80 → windows host │  │
│  │    - Caddyfile mount                      │  │
│  │    - Let's Encrypt cert otomatik          │  │
│  │    ↓ reverse_proxy backend:3001           │  │
│  │                                           │  │
│  │  Service 2: backend (Node.js)             │  │
│  │    - Build from server/Dockerfile         │  │
│  │    - Entry: node --env-file=.env.webhook  │  │
│  │            server/webhook.cjs             │  │
│  │    - exposes 3001 to compose network only │  │
│  │    ↓ sql://                               │  │
│  │                                           │  │
│  │  Service 3: postgres                      │  │
│  │    - postgres:16-alpine                   │  │
│  │    - exposes 5432 to compose network only │  │
│  │    - volume: ./postgres_data bind mount   │  │
│  │    - schema: server/migrations/001_init   │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  Socket.IO broadcast emits through Caddy →      │
└──────────────────────────────────────────────────┘
                        │
                        │ wss://gumruc.com (Caddy upgrade)
                        ▼
              Frontend (lokal Mac, localhost:3000)
                        │
                        │ Not: Frontend hâlâ API_BASE_URL ile
                        │ existing Mac mini/Hostinger MySQL
                        │ backend'ine de bağlanıyor (paralel)
                        ▼
              server/index.cjs (MySQL, Mac mini / Hostinger,
              user management, analytics — DOKUNMUYOR)
```

### Paralel İki Backend

| | **Existing Backend** (dokunulmaz) | **Webhook Backend** (yeni) |
|---|---|---|
| **Dosya** | `server/index.cjs` (445 satır) | `server/webhook.cjs` (yeni, ~150 satır) |
| **DB** | MySQL (Hostinger) | Postgres (Windows Docker) |
| **Deps** | mysql2, dotenv | pg, express-rate-limit, --env-file native |
| **Host** | Mac mini veya Hostinger | Windows 11 Home + Docker |
| **Endpoint'ler** | `/api/signals`, `/api/users`, `/api/analyze`, socket.io for existing signals | `/api/webhook` (POST), `/api/webhook/signals` (GET), `/health`, socket.io for webhook signals |
| **Env file** | `.env` (tracked placeholder) | `.env.webhook` (gitignored) |
| **Public** | Yok (lokal/private) | `https://gumruc.com` (port forward + Caddy LE) |
| **Amaç** | User mgmt, historical signals from existing system | TradingView webhook alert receiver |

---

## Section B — Backend (supersedes §4)

### B.1 `server/webhook.cjs` — Yeni Dosya

~150 satırlık minimal Express app. Sadece webhook + socket.io. MySQL ile hiçbir temas yok.

**Sorumluluklar:**
- `POST /api/webhook` — secret validate + rate limit + Postgres insert + socket.io broadcast
- `GET /api/webhook/signals?limit=N` — Postgres'ten son N webhook signal
- `GET /health` — uptime + DB ping
- Socket.io server ayrı bir yolda (örn. `/ws`) veya root'ta, yeni namespace (`/webhook`) ile MySQL backend ile çakışmasın

**Yapılacak işlemler:**
```js
// server/webhook.cjs
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',').map(s => s.trim()).filter(Boolean);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (err) => console.error('[pg] pool error:', err));

app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true); // server-to-server (TradingView)
        if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        console.warn('[cors] rejected origin:', origin);
        return cb(new Error('CORS: origin not allowed'));
    },
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(bodyParser.json());

const io = new Server(server, {
    cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] },
    path: '/webhook-ws'  // separate path so it doesn't collide with
                         // existing socket.io on the MySQL backend
});

const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' }
});

// Helpers
async function loadSignals(limit = 500) {
    const { rows } = await pool.query(
        'SELECT id, strategy, symbol, side, price::float AS price, time, note, source, confidence::float AS confidence FROM signals ORDER BY time DESC LIMIT $1',
        [limit]
    );
    return rows;
}

async function saveSignal(signal) {
    await pool.query(
        `INSERT INTO signals (id, strategy, symbol, side, price, time, note, source, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [signal.id, signal.strategy, signal.symbol, signal.side, signal.price,
         signal.time, signal.note, signal.source, signal.confidence]
    );
}

// Routes
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.status(200).json({ status: 'ok', uptime: process.uptime() });
    } catch (e) {
        res.status(500).json({ status: 'degraded', error: e.message });
    }
});

app.get('/api/webhook/signals', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '500', 10), 5000);
    const signals = await loadSignals(limit);
    res.json(signals);
});

app.post('/api/webhook', webhookLimiter, async (req, res) => {
    if (!WEBHOOK_SECRET) {
        return res.status(500).json({ error: 'Server misconfigured: WEBHOOK_SECRET not set' });
    }
    if (req.body.secret !== WEBHOOK_SECRET) {
        console.warn('[webhook] rejected - invalid secret from', req.ip);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const { secret, ...data } = req.body;

    if (!data.symbol || !data.side || !data.price) {
        return res.status(400).json({ error: 'Missing required fields: symbol, side, price' });
    }

    const signal = {
        id: data.id || `wh_${Date.now()}`,
        strategy: data.strategy || 'External_Webhook',
        symbol: String(data.symbol).toUpperCase(),
        side: String(data.side).toUpperCase(),
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

const PORT = parseInt(process.env.PORT || '3001', 10);
// In Docker container, bind to 0.0.0.0 (container-internal); compose
// network + Caddy handle external exposure
const BIND = process.env.BIND_HOST || '0.0.0.0';
server.listen(PORT, BIND, () => {
    console.log(`🚀 Webhook backend listening on ${BIND}:${PORT}`);
    console.log(`👉 Webhook endpoint: http(s)://<public-url>/api/webhook`);
});
```

### B.2 `server/Dockerfile` — Backend Container

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./server/
COPY .env.webhook ./.env.webhook
USER node
EXPOSE 3001
CMD ["node", "--env-file=.env.webhook", "server/webhook.cjs"]
```

**Not:** `COPY .env.webhook` build context'te `.env.webhook` dosyasının bulunması gerekiyor. Alternatif olarak compose'da runtime mount:

```yaml
backend:
  build:
    context: .
    dockerfile: server/Dockerfile
  volumes:
    - ./.env.webhook:/app/.env.webhook:ro
```

Tercih: **compose runtime mount** (Dockerfile'dan `COPY .env.webhook` çıkarılır) — image'a secret bake etmeyiz, farklı environment'larda (dev/prod) farklı env dosyası kullanılabilir.

### B.3 `docker-compose.yml` — Full Stack

Plan'daki orijinal Task 3 sadece postgres servisi yazıyordu. Amendment'le **3 servis** oluyor:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: fidelio_webhook_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: fidelio
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: fidelio_signals
    volumes:
      - ./postgres_data:/var/lib/postgresql/data
      - ./server/migrations:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U fidelio -d fidelio_signals"]
      interval: 10s
      timeout: 5s
      retries: 5
    # No ports exposed externally — only reachable within compose network

  backend:
    build:
      context: .
      dockerfile: server/Dockerfile
    container_name: fidelio_webhook_backend
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./.env.webhook:/app/.env.webhook:ro
    environment:
      # DATABASE_URL uses compose service name (DNS) — overrides .env.webhook
      DATABASE_URL: postgres://fidelio:${POSTGRES_PASSWORD}@postgres:5432/fidelio_signals
      BIND_HOST: 0.0.0.0
      PORT: 3001
    # No ports exposed externally — only reachable within compose network
    # Caddy reverse-proxies through docker network

  caddy:
    image: caddy:2-alpine
    container_name: fidelio_webhook_caddy
    restart: unless-stopped
    depends_on:
      - backend
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config

volumes:
  caddy_data:
  caddy_config:
```

### B.4 `Caddyfile` — Docker Version

```
gumruc.com, www.gumruc.com {
    reverse_proxy backend:3001

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    log {
        output file /data/log/gumruc.log {
            roll_size 10mb
            roll_keep 5
        }
        format json
    }
}
```

`backend:3001` — Docker compose network DNS, caddy container'dan backend container'ına otomatik resolution.

### B.5 `.env.webhook` — Webhook Env

Windows PC'de `.env.webhook` dosyası manuel oluşturulur (gitignored):

```ini
PORT=3001
WEBHOOK_SECRET=<openssl rand -hex 32 çıktısı>
ALLOWED_ORIGINS=http://localhost:3000
# DATABASE_URL compose tarafından override ediliyor — burada placeholder kalır
DATABASE_URL=postgres://fidelio:___OVERRIDDEN_BY_COMPOSE___@postgres:5432/fidelio_signals
POSTGRES_PASSWORD=<openssl rand -hex 16 çıktısı>
```

### B.6 `server/index.cjs` — DOKUNULMUYOR

Mevcut MySQL backend hiçbir değişiklik almıyor. Rate limit, secret validation, CORS tightening gibi iyileştirmeler **bu task'ın kapsamı dışında**. Gelecekte ayrı bir iyileştirme task'ı olarak düşünülebilir.

---

## Section C — Frontend (supersedes §5.1-5.3)

### C.1 `utils/config.ts` — Genişletme (yeni dosya yazmıyoruz)

Mevcut `utils/config.ts` (13 satır) **korunuyor**, üstüne yeni constant ekleniyor:

```ts
// utils/config.ts
export const getApiBaseUrl = () => {
    if (import.meta.env.PROD) {
        return import.meta.env.VITE_API_URL || '';
    }
    return '';
};

export const API_BASE_URL = getApiBaseUrl();

// Webhook backend URL (separate from MySQL backend)
// Dev: tries VITE_WEBHOOK_URL, falls back to API_BASE_URL if not set
// Prod: VITE_WEBHOOK_URL set to https://gumruc.com
export const WEBHOOK_API_URL =
    (import.meta.env.VITE_WEBHOOK_URL as string | undefined) || API_BASE_URL;
```

### C.2 `.env.local` Değişiklikleri

```ini
VITE_WEBHOOK_URL=https://gumruc.com
# (geri kalan mevcut env satırları dokunulmuyor)
```

Dev modunda Vite proxy ile test yapmak için geçici olarak `VITE_WEBHOOK_URL=http://localhost:3001` de olabilir.

### C.3 Refactor Kapsamı — Daraltıldı

Orijinal spec 8 dosyada `http://localhost:3001` refactor'u istiyordu. **Gerçek durum:** e6311eb'de bu dosyaların tümü zaten `API_BASE_URL`/`utils/config.ts` kullanıyor — refactor GEREKLİ DEĞİL.

Sadece **`WebhookManager.tsx`'te 1 satır** değişiyor: `webhookUrl` constant'ı `WEBHOOK_API_URL` kullanacak (`API_BASE_URL` yerine):

```tsx
// ÖNCE (e6311eb'de)
const webhookUrl = `${API_BASE_URL}/api/webhook`;

// SONRA (amendment ile)
import { WEBHOOK_API_URL } from '../utils/config';
const webhookUrl = `${WEBHOOK_API_URL}/api/webhook`;
```

Diğer tüm frontend kodu aynı kalıyor.

### C.4 WebhookManager `secret` Bug — Hâlâ Gerekli

Parent spec §5.4 ve §5.5 (Math.random secret → localStorage) **geçerliliğini koruyor**. Bu bug e6311eb'de hâlâ var.

### C.5 App.tsx `<WebhookManager />` Render — Hâlâ Gerekli

Parent spec §5.8 (WebhookManager import var ama JSX yok — "webhook" view mode ekle + NavLink + render bloğu) **geçerliliğini koruyor**. e6311eb de aynı "import-ama-render-yok" durumunda.

### C.6 `onManualSignal` Prop Kaldırma — Hâlâ Gerekli

Parent spec §5.9 geçerli.

---

## Section D — Plan Task Revizyonları (supersedes Tasks 6-16)

| Orijinal Task | Amendment Durumu | Yeni İçerik |
|---|---|---|
| Task 1 (branch) | ✅ Tamam | — |
| Task 2 (pg + express-rate-limit) | ✅ Tamam (rebase ile çözüldü) | — |
| Task 3 (docker-compose.yml + migration SQL) | **Genişletildi** | Compose 3 servis (postgres + backend + caddy). Migration SQL aynı. Dockerfile, Caddyfile, .env.webhook örneği de bu task'ta oluşturulur. |
| Task 4 (.env) | **Rename** | `.env.webhook` (gitignored) oluşturulur, `.env` (tracked placeholder) dokunulmuyor |
| Task 5 (Postgres start + schema verify) | **Windows'ta** | macOS tarafında verify yapmıyoruz. Windows Claude `docker compose up -d postgres` çalıştırıp schema doğrulaması yapacak. |
| Task 6 (pg.Pool in server/index.cjs) | **YENİ: `server/webhook.cjs` yaz** | Section B.1'deki full dosya. index.cjs dokunulmuyor. |
| Task 7 (secret validation) | **webhook.cjs'de** | Section B.1 içinde integrated |
| Task 8 (CORS allowlist) | **webhook.cjs'de** | Section B.1 içinde integrated |
| Task 9 (rate limit) | **webhook.cjs'de** | Section B.1 içinde integrated |
| Task 10 (127.0.0.1 bind) | **Değişti** | Docker container içinde `0.0.0.0:3001` bind (container network içi). Caddy container ilk katman. `127.0.0.1` bind gereksiz (compose network izolasyonu yeterli). |
| Task 11 (package.json scripts) | **Güncellendi** | `npm run webhook` eklenir: `node --env-file=.env.webhook server/webhook.cjs`. `db:up`, `db:down`, `db:logs`, `caddy` script'leri eklenir. `server` script'i EKLENMEZ (mevcut Hostinger backend için `npm run server` yok zaten, biz çakıştırmayız). |
| Task 12 (services/config.ts) | **İPTAL** | `utils/config.ts` genişletilir (Section C.1). Yeni dosya oluşturulmaz. |
| Task 13 (SignalContext URL refactor) | **İPTAL** | Zaten API_BASE_URL kullanıyor, dokunma. |
| Task 14 (aiService URL refactor) | **İPTAL** | Zaten API_BASE_URL kullanıyor. |
| Task 15 (SystemDiagnostics URL refactor) | **İPTAL** | Zaten API_BASE_URL kullanıyor. |
| Task 16 (DatabaseViewer + NotificationSettings) | **İPTAL** | Zaten API_BASE_URL kullanıyor. |
| Task 17 (WebhookManager port 80 fix) | **İPTAL** | e6311eb'de zaten düzeltilmiş. |
| Task 18 (secret localStorage) | **Geçerli** | Orijinal plan task'ı aynen uygulanır. |
| Task 19 (handleInject backend POST) | **Değişti (minor)** | `webhookUrl` constant'ı `WEBHOOK_API_URL`'den gelir (C.3'teki import). |
| Task 20 (testWebhook with secret) | **Değişti (minor)** | Aynı şekilde `WEBHOOK_API_URL` kullanır. |
| Task 21 (onManualSignal kaldır) | **Geçerli** | Orijinal plan task'ı aynen uygulanır. |
| Task 22 (App.tsx render WebhookManager) | **Geçerli** | Orijinal plan task'ı aynen uygulanır. |
| Task 23 (Frontend integration smoke test) | **Geçerli** | Aynı akış, sadece webhook endpoint'i farklı URL'e gidiyor. |
| Task 24 (full tsc check) | **Geçerli** | Aynen. |
| Task 25 (CGNAT verification) | **Geçerli** | Windows Claude `curl ifconfig.me` + router WAN IP check yapacak. |
| Task 26 (DNS A records for gumruc.com) | **Geçerli** | Hostinger DNS'te `@` ve `www` A record → modem public IP. |
| Task 27 (Router port forward + DHCP reservation) | **Geçerli (Windows version)** | LAN IP 192.168.0.22 (DHCP reservation), ports 443 + 80 → 192.168.0.22. |
| Task 28 (Tools install) | **Değişti — Windows** | Docker Desktop + Git for Windows. Homebrew yok, brew install yok. |
| Task 29 (Caddyfile create) | **Değişti** | Docker caddy image için Caddyfile (Section B.4). Standalone Caddy kurulumu yok. |
| Task 30 (First Caddy run + Let's Encrypt) | **Değişti** | `docker compose up -d` ile caddy container başlar, Let's Encrypt ACME challenge port 80 üzerinden yapılır. Windows Firewall ve port forward hazır olmalı. |
| Task 31 (launchd + brew services) | **İPTAL** | launchd yok. Docker Compose `restart: unless-stopped` + Docker Desktop "Start on login" yeterli. |
| Task 32 (Docker start on login) | **Geçerli (Windows version)** | Docker Desktop Settings → General → Start on login. |
| Task 33 (TradingView alert E2E) | **Geçerli** | `https://gumruc.com/api/webhook` URL, secret'lı JSON body. |
| Task 34 (success criteria) | **Geçerli** | Aynı checklist. |
| Task 35 (merge/PR) | **Geçerli ama değiştirilmiş** | Feature branch main'e merge EDİLMEZ (ayrı kalır, Windows prod'u bağımsız). Sadece feature branch kendi içinde commit'ler kalır. Main dokunulmaz. |

**Sonuç:** 35 task'tan **9 task tamamen iptal**, **7 task değişti**, **19 task değişmedi veya sadece minor değişiklik**. Net iş yükü yaklaşık **%40 azaldı**.

---

## Section E — Değişmeyen Şeyler

- Spec Section 1-2 (bağlam, hedefler, hedef-olmayanlar)
- Spec Section 5.4-5.9 (WebhookManager secret bug + localStorage + handleInject + testWebhook + onManualSignal + App.tsx render)
- Spec Section 7 (5-katmanlı test planı)
- Spec Section 8 (monitoring — log tail komutları Windows'a göre değişir ama konsept aynı)
- Spec Section 9 (rollback planı)
- Spec Section 10 (bilinen sınırlamalar)
- Spec Section 11 (başarı kriterleri — <10s latency hedefi)
- Spec Section 12 (out of scope)
- TradingView alert JSON formatı
- Secret + rate limit + CORS fikirleri
- Postgres schema ve migration SQL
- Frontend'in Webhook view'ının çalışma akışı

## Section F — Windows Adaptasyonu Detayları

### Port Forward — Windows Firewall

Windows PC'de inbound bağlantılara izin vermek için Windows Firewall kuralları:

```powershell
New-NetFirewallRule -DisplayName "HTTPS Inbound (Caddy)" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
New-NetFirewallRule -DisplayName "HTTP Inbound (ACME)" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
```

### Sleep Prevention — Windows

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 15
```

### DHCP Reservation

Router admin panelinde LAN ayarları altında DHCP Reservation — Windows PC MAC'i → 192.168.0.22 sabitlenir.

### Docker Desktop WSL2 Networking

Docker Desktop Windows ports'u WSL2 içinden host'a otomatik forward eder. `ports: "443:443"` compose'da Windows host'un 443'üne bind eder. Router port forward public 443 → 192.168.0.22:443 çalışır.

---

## Değişiklik Onayı

- **User onayı:** "Hayır port forvard daha iyi olacak" (CF Tunnel alternatifi reddedildi) + "hostinger mysql hala geçerli" (paralel dosya stratejisi onaylandı) + "hepsinde de ne diyorsan o olsun" (genel yetki)
- **Implementation impact:** Net azalma — iş yükü %40 düştü
- **Risk:** Daha düşük. Hostinger MySQL production etkilenmiyor. Windows deploy tarafı Docker-everything ile OS-spesifik karmaşadan bağımsız.

## Sıradaki Adım

Bu amendment commit'lendikten sonra Task 3 implementer dispatch edilecek. Task 3'ün kapsamı: `docker-compose.yml` (3 servis), `server/migrations/001_init.sql`, `server/Dockerfile`, `Caddyfile`. Bu dosyalar macOS Claude tarafında yazılır, commit + push edilir, Windows Claude `git pull` ile alır.
