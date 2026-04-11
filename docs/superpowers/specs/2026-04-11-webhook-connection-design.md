# Webhook Connection Design — TradingView → Laptop Self-Host

**Tarih:** 2026-04-11
**Durum:** Design (brainstorming onaylı, implementation planı bekleniyor)
**Scope:** TradingView webhook alert'lerinin ev laptop'ta çalışan FidelioAI backend'ine güvenli ve kalıcı şekilde ulaşması; gelen sinyallerin Postgres'te saklanması ve frontend'e anında broadcast edilmesi.

---

## 1. Bağlam ve Motivasyon

FidelioAI, Binance WebSocket verisi üzerinden çalışan gerçek zamanlı bir trading dashboard'u. TradingView'dan gelen alert'ler platformun sinyal kaynaklarından biri olacak, ama mevcut webhook entegrasyonu lokal dev state'inde bug'lı ve dışa açık değil:

- `components/WebhookManager.tsx:84` — `webhookUrl = 'http://localhost:80/api/webhook'` (yanlış port; `3001` olmalı)
- `components/WebhookManager.tsx:108` — health check aynı yanlış portu kullanıyor
- `components/WebhookManager.tsx:85` — `secret = sk_live_${Math.random()}` her render'da yenileniyor (kullanışsız)
- `server/index.cjs:66` — `POST /api/webhook` secret'ı hiç doğrulamıyor (auth yok)
- Backend sadece `localhost:3001`'de erişilebilir; TradingView buna POST atamaz
- `server/index.cjs` sinyalleri `signals_db.json` dosyasına yazıyor — ephemeral, replicate edilemez, taşınamaz

Hedef: Bu sorunları kalıcı olarak çözerek TradingView alert'lerini **10 saniye altı gecikmeyle** frontend'e ulaştırmak. Çözüm tamamen **ücretsiz** olmalı (kullanıcı tercihi) ve **laptop'ta self-host** edilmeli.

## 2. Hedefler ve Hedef-Olmayanlar

### Hedefler
- TradingView alert → FidelioAI frontend'inde görünen sinyal arası uçtan uca gecikme **<10 saniye** (hedef <3 sn)
- Webhook endpoint internete **HTTPS** üzerinden açık (TradingView HTTP kabul etmiyor)
- Yetkisiz POST'lar **secret** ile bloklanıyor (DoS ve spam'e karşı)
- Sinyal geçmişi **Postgres**'te kalıcı (redeploy veya restart'ta kaybolmuyor)
- Laptop reboot sonrası tüm servisler **otomatik kalkıyor**, manuel müdahale gerekmez
- Aylık maliyet **$0** (kullanılan tüm servisler free tier veya open-source)

### Hedef-Olmayanlar
- **Multi-region** veya **high-availability** — tek laptop, tek data center (ev), SPOF kabul ediliyor
- **Kullanıcı yönetimi** — tek kullanıcı (developer + kendisi), auth katmanı minimum (tek bir webhook secret)
- **Frontend'i de laptop'tan servis etmek** — frontend lokal dev olarak kalacak (`localhost:3000`) veya ayrı bir yere deploy edilecek; spec kapsamı sadece backend
- **Sinyal stratejisi / işlem kararları** — spec sadece iletim katmanı, karar mantığı kapsam dışı
- **Backup / disaster recovery** — bilinen sınırlama olarak not edildi, sonraki iterasyonda ele alınacak
- **Postgres sharding, replication, read replica** — tek node yeterli
- **Alert deduplication (idempotency key)** — `INSERT ... ON CONFLICT (id) DO NOTHING` ile naive koruma var, gerçek deduplication başka bir konu

## 3. Mimari Genel Bakış

### 3.1 Veri Akışı

```
TradingView Alert
     │
     │  HTTPS POST  {secret, symbol, side, price, strategy, time}
     ▼
https://gumruc.com/api/webhook
     │
     │  DNS A record → modem public IP
     ▼
Ev Modem/Router
     │
     │  NAT port forward: 443 → laptop_lan_ip:443
     │  NAT port forward: 80  → laptop_lan_ip:80  (Let's Encrypt HTTP-01 challenge için)
     ▼
┌─────────────────────────────────────────────────┐
│  LAPTOP (dedicated, ev, 7/24 açık, sleep kapalı)│
│                                                 │
│   Caddy  :443  (reverse proxy + Let's Encrypt)  │
│     │                                           │
│     ▼                                           │
│   Node.js backend  127.0.0.1:3001               │
│   (server/index.cjs)                            │
│     │                                           │
│     ├─► Postgres 127.0.0.1:5432  (Docker)       │
│     │    (signals table)                        │
│     │                                           │
│     └─► socket.io broadcast                     │
│              │                                  │
└──────────────┼──────────────────────────────────┘
               │
               │  wss://gumruc.com (Caddy upgrade)
               ▼
     Frontend  (localhost:3000, lokal dev)
```

### 3.2 Bileşenler

| Bileşen | Nerede | Rolü |
|---|---|---|
| **DNS** (`gumruc.com` A record) | Registrar DNS paneli | Domain → modem public IP |
| **Modem NAT** | Router admin panel | Public port 443 → laptop LAN IP 443; port 80 (ACME için) |
| **Caddy** | Laptop process (`brew services`) | HTTPS terminator, Let's Encrypt otomatik, reverse proxy to Node |
| **Node.js backend** | Laptop process (`launchd`) | Webhook alır, secret doğrular, Postgres'e yazar, socket.io broadcast |
| **Postgres** | Laptop Docker container (`docker compose`) | Sinyal persistence |
| **Frontend** | Lokal (`localhost:3000`) | `wss://gumruc.com`'e bağlanır, yeni sinyalleri dinler, geçmişi `GET /api/signals`'ten çeker |

### 3.3 Neden bu seçimler

- **Caddy vs Nginx:** Caddy Let's Encrypt'i otomatik handle ediyor; Caddyfile ~10 satır. Nginx aynı iş için certbot + cron + complex config gerektirir.
- **Postgres (Docker) vs native install:** Docker volume data persistence'i OS upgrade/Node version change'den izole ediyor. `docker compose up -d` ile tek komut kurulum.
- **Postgres vs SQLite:** Kullanıcı Postgres tercih etti. Pratikte SQLite tek-node için yeterli olur, ama Postgres gelecek-proof (analytics query, birden fazla reader/writer).
- **`127.0.0.1`'de bind:** Backend doğrudan internet'ten erişilemez, sadece Caddy üzerinden. Güvenlik katmanı.
- **Webhook secret JSON body'de, header'da değil:** TradingView alert'leri custom HTTP header yollayamıyor — tek auth yolu body içinde bir secret field.
- **localStorage-based frontend secret:** Frontend env var (`VITE_*`) build bundle'ında plain görünür. localStorage ise tarayıcıya özel, hosted frontend'de bile güvenli.

### 3.4 Fallback: Cloudflare Tunnel

Port forward verification başarısız olursa (CGNAT, router kilitli):
- Caddy **silinir/durdurulur**, yerine `cloudflared` daemon
- DNS `gumruc.com` Cloudflare nameserver'larına taşınır (bir defalık, ~24 saat propagation)
- Cloudflare dashboard'da tunnel oluşturulur, `gumruc.com` → `http://localhost:3001` eşlemesi
- Port forward gerekmez, public IP gerekmez
- Backend + Postgres + frontend kodu **değişmez**

## 4. Backend Değişiklikleri (`server/index.cjs`)

### 4.1 Yeni Environment Variables (`.env`)

```ini
PORT=3001
WEBHOOK_SECRET=<REPLACE_WITH_OUTPUT_OF: openssl rand -hex 32>
ALLOWED_ORIGINS=http://localhost:3000
DATABASE_URL=postgres://fidelio:<REPLACE_WITH_POSTGRES_PASSWORD>@localhost:5432/fidelio_signals
GEMINI_API_KEY=<mevcut değer — değiştirme>
POSTGRES_PASSWORD=<REPLACE_WITH_OUTPUT_OF: openssl rand -hex 16>
```

**Secret'ları üret ve `.env`'e yapıştır (implementation adımı):**
```bash
echo "WEBHOOK_SECRET=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
```
Çıktıları `.env` içine literal değer olarak yaz. `<...>` placeholder'ları literal bırakılmaz — commit hatasına yol açar.

`.gitignore`'a `.env`, `postgres_data/`, `server/signals_db.json` eklenir. Node 20.6+ native `--env-file` desteği kullanılır — `dotenv` paketi eklenmez.

### 4.2 Secret Validation (`POST /api/webhook`)

```js
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

app.post('/api/webhook', webhookLimiter, async (req, res) => {
  if (!WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }
  if (req.body.secret !== WEBHOOK_SECRET) {
    console.warn('[webhook] Rejected - invalid secret from', req.ip);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { secret, ...data } = req.body;
  // ... mevcut validation + signal object oluşturma
  await saveSignal(signal);
  io.emit('new_signal', signal);
  return res.status(200).json({ success: true, signalId: signal.id });
});
```

### 4.3 CORS Daraltması

```js
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // TradingView (server-to-server)
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS: origin not allowed'));
  },
  methods: ['GET', 'POST'],
  credentials: true
}));

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] }
});
```

### 4.4 Postgres Migration

**Yeni dependency:** `npm install pg express-rate-limit`

**Schema** (`server/migrations/001_init.sql`):
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

Docker compose `./server/migrations:/docker-entrypoint-initdb.d:ro` mount ile ilk container başlangıcında otomatik çalıştırılır.

**Helper fonksiyonlar:**
```js
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function loadSignals(limit = 500) {
  const { rows } = await pool.query(
    'SELECT * FROM signals ORDER BY time DESC LIMIT $1', [limit]
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
```

Mevcut `fs.readFileSync`/`fs.writeFileSync` çağrıları bu helper'larla değiştirilir. `signals_db.json` dosyası artık kullanılmaz (eski veri opsiyonel olarak migrate script ile Postgres'e taşınabilir).

### 4.5 Rate Limit

```js
const rateLimit = require('express-rate-limit');
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});
```

Sadece `/api/webhook`'a uygulanır. TradingView gerçekçi trafiği dakikada 100'ün çok altındadır.

### 4.6 PORT Binding

```js
const PORT = parseInt(process.env.PORT || '3001', 10);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Backend listening on 127.0.0.1:${PORT}`);
});
```

`127.0.0.1` kritik — backend internetten doğrudan erişilemez, sadece Caddy proxy üzerinden.

### 4.7 `server/index.cjs` — Değişiklik Özeti

| Değişiklik | Tür |
|---|---|
| Secret validation `POST /api/webhook` | Yeni |
| CORS `*` → allowlist | Güncelleme |
| Rate limit webhook endpoint | Yeni |
| `fs.*` → `pg.Pool` | Refactor |
| Schema migration script | Yeni |
| PORT `0.0.0.0` → `127.0.0.1` | Güncelleme |
| `signals_db.json` referansları | Kaldırılıyor |
| `/api/signals` limit parametresi | Güncelleme |
| `/api/forward`, `/api/analyze`, `/health` | Değişmez |

## 5. Frontend Değişiklikleri

### 5.1 Yeni Env Variable

`.env.local`:
```ini
VITE_BACKEND_URL=http://localhost:3001
# Production: https://gumruc.com
```

### 5.2 Yeni Helper: `services/config.ts`

```ts
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

export const config = {
  backendUrl: BACKEND_URL,
  webhookUrl: `${BACKEND_URL}/api/webhook`,
  signalsUrl: `${BACKEND_URL}/api/signals`,
  forwardUrl: `${BACKEND_URL}/api/forward`,
  healthUrl: `${BACKEND_URL}/health`,
  socketUrl: BACKEND_URL,
} as const;
```

Tüm hardcoded `http://localhost:3001` ve `http://localhost:80` referansları bu config'e bağlanır.

### 5.3 `context/SignalContext.tsx` URL Refactor

| Satır | Önce | Sonra |
|---|---|---|
| ~2 | — | `import { config } from '../services/config';` |
| ~234 | `fetch('http://localhost:3001/api/forward', ...)` | `fetch(config.forwardUrl, ...)` |
| ~258 | `io('http://localhost:3001', ...)` | `io(config.socketUrl, ...)` |
| ~274 | `fetch('http://localhost:3001/api/signals')` | `fetch(config.signalsUrl)` |
| ~386 | `fetch('http://localhost:3001/api/webhook', ...)` | `fetch(config.webhookUrl, ...)` |

### 5.4 `components/WebhookManager.tsx` Bug Fix'ler

- **Satır 84:** `webhookUrl = 'http://localhost:80/api/webhook'` → `config.webhookUrl`
- **Satır 108:** Health check `http://localhost:80/health` → `config.healthUrl`
- **Satır 85:** `secret = sk_live_${Math.random()...}` → **kaldırılıyor**, yerine localStorage-backed state

### 5.5 Secret Model — localStorage

```tsx
const [secret, setSecret] = useState<string>(() => {
  return localStorage.getItem('webhook_secret') || '';
});

const handleSecretChange = (newSecret: string) => {
  setSecret(newSecret);
  if (newSecret) localStorage.setItem('webhook_secret', newSecret);
  else localStorage.removeItem('webhook_secret');
};
```

**UI:** Templates tab'ının üstüne yeni bir input kutusu (type=password). Kullanıcı backend'deki `WEBHOOK_SECRET`'ı bir kereliğine buraya yapıştırır, localStorage'da saklanır, tüm template generation'da kullanılır.

**Neden env var değil:** `VITE_*` env değişkenleri build bundle'ında plain görünür. Hosted frontend'de herkes bundle'ı okuyarak secret'ı görür. localStorage cihaza özel.

### 5.6 `handleInject` — Backend'e POST

Manual inject lokal state'i güncellemek yerine `POST /api/webhook`'a gider — secret'la birlikte. Backend Postgres'e yazar ve socket.io echo'su ile UI güncellenir. Böylece birden fazla tarayıcı açık olsa bile senkron.

```tsx
const handleInject = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!manualSymbol || !manualPrice) return;
  if (!secret) { alert('Secret lazım'); return; }

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

  const res = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    setManualSymbol('');
    setManualPrice('');
  } else {
    alert(`Hata: ${res.status}`);
  }
};
```

`handleInject` backend'e POST atıp socket.io echo'sunu beklediği için `onManualSignal` prop'unun UI güncelleme rolü kalmıyor. Implementation adımı: `WebhookManagerProps` interface'inden `onManualSignal` kaldırılır, `App.tsx` (ve prop'u geçen diğer parent'lar) bu prop'u geçmeyecek şekilde güncellenir. Eğer başka bir çağrım noktası varsa (Grep: `onManualSignal`) onlar da audit edilir.

### 5.7 `testWebhook` — Secret İle POST

Mevcut test fonksiyonu secret'sız POST atıyor, artık 401 alacak. `secret`'ı payload'a ekleyerek güncellenir.

### 5.8 Frontend Değişiklik Özeti

| Dosya | Değişiklik |
|---|---|
| `.env.local` | `VITE_BACKEND_URL` yeni |
| `services/config.ts` | **Yeni dosya** |
| `context/SignalContext.tsx` | 4 URL refactor |
| `components/WebhookManager.tsx` | Bug fix + secret model + handleInject rewrite + testWebhook fix + secret input UI |

## 6. Deploy & Kurulum (Laptop)

### 6.1 Kurulacak Araçlar

```bash
# Homebrew (yoksa)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Docker Desktop
brew install --cask docker
# (ilk açılış manuel, "Start Docker Desktop when you log in" ayarı aç)

# Caddy
brew install caddy

# Node.js (en az 20.6+, native --env-file için)
brew install node@20
```

### 6.2 `docker-compose.yml`

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

### 6.3 `Caddyfile`

```caddyfile
gumruc.com, www.gumruc.com {
    reverse_proxy localhost:3001

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    log {
        output file /usr/local/var/log/caddy/gumruc.log {
            roll_size 10mb
            roll_keep 5
        }
        format json
    }
}
```

### 6.4 `package.json` Script Eklemeleri

```json
{
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vite build",
    "preview": "vite preview",
    "server": "node --env-file=.env server/index.cjs",
    "db:up": "docker compose up -d postgres",
    "db:down": "docker compose down",
    "db:logs": "docker compose logs -f postgres",
    "caddy": "caddy run --config Caddyfile"
  }
}
```

### 6.5 Network Kurulumu

**6.5.1 Public IP verification (CGNAT kontrol):**
```bash
curl ifconfig.me
```
Sonra router admin → Status/WAN → WAN IP oku. İki IP aynı değilse **fallback plana geç** (bkz. 3.4).

**6.5.2 DNS A records (`gumruc.com`):**
```
A  @    <modem_public_ip>  3600
A  www  <modem_public_ip>  3600
```

**6.5.3 Router port forward:**
```
443 TCP → laptop_lan_ip:443
80  TCP → laptop_lan_ip:80   (Let's Encrypt HTTP-01 challenge için)
```

Router'da laptop için **DHCP Reservation** ekle (MAC → hep aynı LAN IP).

**6.5.4 macOS sleep settings:**
```bash
sudo pmset -c sleep 0
sudo pmset -c disksleep 0
sudo pmset -c powernap 0
sudo pmset -c displaysleep 15
sudo pmset -c lidwake 1
```

### 6.6 Kalıcı Servisler

**Postgres:** Docker Desktop "Start on login" + `restart: unless-stopped`

**Backend — `~/Library/LaunchAgents/com.fidelio.backend.plist`:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.fidelio.backend</string>
    <key>WorkingDirectory</key><string>/Users/mertaysune/fidelioai/FidelioAI</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>--env-file=.env</string>
        <string>server/index.cjs</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/usr/local/var/log/fidelio/backend.log</string>
    <key>StandardErrorPath</key><string>/usr/local/var/log/fidelio/backend.err.log</string>
</dict>
</plist>
```

Yükleme:
```bash
mkdir -p /usr/local/var/log/fidelio
launchctl load ~/Library/LaunchAgents/com.fidelio.backend.plist
launchctl start com.fidelio.backend
```

**Caddy — `brew services`:**
```bash
sudo cp Caddyfile /opt/homebrew/etc/Caddyfile
sudo brew services start caddy
```

### 6.7 TradingView Alert Kurulumu

1. Alert oluştur → Notifications tab
2. **Webhook URL:** `https://gumruc.com/api/webhook`
3. **Message (JSON):**
```json
{
  "secret": "<WEBHOOK_SECRET>",
  "symbol": "{{ticker}}",
  "side": "BUY",
  "price": "{{close}}",
  "strategy": "Breakout_Alert",
  "time": "{{time}}"
}
```

## 7. Test Planı

### Katman 1 — Docker + Postgres
```bash
npm run db:up
docker compose ps    # healthy
docker exec -it fidelio_postgres psql -U fidelio -d fidelio_signals -c "\dt"
# signals tablosu görünmeli
```

### Katman 2 — Backend + Postgres
```bash
npm run server
curl http://localhost:3001/health
# Secret'sız → 401
# Doğru secret → 200 + DB insert
```

### Katman 3 — Frontend + Backend (lokal)
```bash
npm run dev
# localhost:3000 → Signal Hub → secret yapıştır → Manual Test → Inject
# Sinyal UI'da anında görünür
```

### Katman 4 — DNS + Caddy + HTTPS
```bash
dig gumruc.com +short
# Mobile data'dan: curl -v https://gumruc.com/health
# Let's Encrypt sertifikası doğrulanır
```

### Katman 5 — Uçtan uca TradingView
Alert oluştur → Test notification → Frontend'de <10 sn içinde görünür → Caddy log'unda POST → Postgres row.

## 8. Monitoring

```bash
tail -f /usr/local/var/log/fidelio/backend.log
tail -f /usr/local/var/log/caddy/gumruc.log
docker compose logs -f postgres

# Sinyal özet
docker exec fidelio_postgres psql -U fidelio -d fidelio_signals \
  -c "SELECT source, COUNT(*), MAX(time) FROM signals GROUP BY source;"

# 401 sayımı (saldırı göstergesi)
grep '"status":401' /usr/local/var/log/caddy/gumruc.log | wc -l
```

## 9. Rollback Planı

| Kırılma noktası | Rollback |
|---|---|
| Lokal kurulum (Postgres/backend) | `docker compose down` + `git checkout server/index.cjs` |
| Frontend bug | `git checkout components/WebhookManager.tsx context/SignalContext.tsx` |
| Caddy / DNS | Port forward kaldır, DNS A record sil — backend lokal çalışmaya devam |
| Tamamen geri dön | `git reset --hard <commit-before>` + `.env`/`Caddyfile`/`docker-compose.yml` manuel sil, `postgres_data/` sil |

## 10. Bilinen Sınırlamalar ve Riskler

1. **SPOF:** Tek laptop, tek ev. Downtime = alert kaybı. Monitoring yok (sonraki iterasyon: UptimeRobot + Telegram alarm).
2. **Laptop reboot:** OS update penceresi = downtime.
3. **ISP IP değişikliği:** DNS eski IP'yi gösterir, trafik kaybolur. Dynamic DNS client sonraki iterasyon.
4. **TradingView plan:** Webhook alert'leri Essential ($14.95/ay) ve üstü. Free plan'da bu mimari anlamsız.
5. **`.env` plain-text secret:** Compromise olursa `openssl rand` ile rotate, backend restart, frontend localStorage + TradingView alert'leri güncelle.
6. **Rate limit bypass (dağıtık saldırı):** Secret olmadan hiçbir şey yapamazlar, sadece log şişer. Gerekirse Cloudflare WAF (tunnel fallback'te zaten var).
7. **Postgres backup yok:** Kritik ise haftalık `pg_dump` → harici disk/cloud. Sonraki iterasyon.

## 11. Başarı Kriterleri

- [ ] TradingView test alert → local frontend gecikmesi **<10 saniye**
- [ ] Secret'sız POST → 401
- [ ] Laptop reboot → tüm servisler (Postgres, backend, Caddy) otomatik kalkıyor
- [ ] `docker compose down && up` → eski sinyaller Postgres'te hâlâ var
- [ ] Signal Hub → secret yapıştır → template kopyala → TradingView akışı çalışıyor
- [ ] Caddy Let's Encrypt sertifikası geçerli, expire > 60 gün
- [ ] Aylık maliyet: $0

## 12. Out of Scope (Sonraki İterasyonlar)

- Uptime monitoring (UptimeRobot, Healthchecks.io, Telegram bot)
- Dynamic DNS client (ISP IP değişikliği için)
- Postgres backup / restore runbook
- Multi-user / oauth
- Webhook payload schema validation (zod/yup)
- Cloudflare WAF / DDoS koruma
- Frontend'i de deploy etmek (şu an lokal dev)
- Signal deduplication (exact duplicate detection beyond `ON CONFLICT`)
- Emergency runbook (secret rotation, tam kesinti kurtarma)
