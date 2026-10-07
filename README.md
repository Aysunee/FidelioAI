# Fidelio

Binance spot ve vadeli piyasaları için gerçek zamanlı kripto tarayıcı: piyasa radarı, funding analizi,
anomali tespiti, TradingView webhook sinyalleri, işlem günlüğü ve portföy takibi.

- **Frontend:** React 19 + TypeScript + Vite (proje kökü: `App.tsx`, `components/`, `context/`, `services/`, `utils/`, `hooks/`)
- **Backend:** Express 5 + socket.io + MySQL (`server/`)

Ayrıntılı mimari ve algoritmalar için [TECHNICAL_DOCUMENTATION.md](TECHNICAL_DOCUMENTATION.md) dosyasına bakın.

## Gereksinimler

- Node.js 20+
- MySQL 8 (geliştirme için ayrı bir veritabanı kullanın; production veritabanına yerelden bağlanmayın)

## Kurulum

```bash
npm install
cp .env.example .env   # değerleri doldurun (gerçek değerleri asla commit etmeyin)
```

### Ortam değişkenleri (`.env`, yalnızca sunucuda)

| Değişken | Açıklama |
| --- | --- |
| `PORT` | Backend portu (varsayılan `3001`) |
| `LISTEN_HOST` | Dinlenen adres. Yerelde yalnızca bu makine için `127.0.0.1` |
| `ALLOWED_ORIGINS` | Virgülle ayrılmış izinli origin listesi. Boşsa tüm origin'lere izin verilir (uyarı loglanır) |
| `TRUST_PROXY` | Ters proxy arkasında gerçek istemci IP'si için (ör. `1`) |
| `JWT_SECRET` | **Production'da zorunlu.** En az 32 karakter rastgele değer (`openssl rand -base64 48`). Boşsa her başlatmada rastgele üretilir ve oturumlar yeniden başlatmada düşer |
| `ALLOW_REGISTRATION` | `true` değilse `POST /api/auth/register` 403 döner |
| `WEBHOOK_SECRET` | TradingView alarm mesajındaki `secret` alanı. Tanımsızsa `/api/webhook` 503 döner |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL bağlantısı |
| `DB_SSL`, `DB_SSL_CA`, `DB_SSL_REJECT_UNAUTHORIZED` | MySQL TLS ayarları (`.env.example` içindeki açıklamalara bakın) |
| `GEMINI_API_KEY` | Yalnızca sunucuda, `/api/analyze` için |

Frontend yalnızca gizli olmayan `VITE_API_URL` değerini okur (build sırasında). Boş bırakılırsa aynı origin kullanılır.
`VITE_` önekli her değer herkese açık JS paketine girer; hiçbir gizli anahtarı frontend'e vermeyin.

### Veritabanı şeması

Komutlar `.env` içindeki veritabanına yazar; doğru ortamda olduğunuzdan emin olun.

```bash
node server/migrate.cjs --yes                    # tabloları oluşturur (idempotent)
node server/migrate-alerts-portfolio.cjs --yes   # mevcut veritabanları için ek tablo/index ve şifre hash'leme
node server/import_users.cjs --yes               # (tek seferlik) server/users_db.json içindeki kullanıcıları içe aktarır
```

## Geliştirme

Frontend ve backend ayrı süreçlerdir:

```bash
npm start      # backend: node server/index.cjs (:3001)
npm run dev    # frontend: Vite (:3000); geliştirmede backend'e aynı makine adı üzerinden :3001 portuyla bağlanır
```

Vite geliştirme sunucusu varsayılan olarak yerel ağa açıktır (telefonla test için). Yalnızca bu makineden
erişim için `DEV_HOST=127.0.0.1 npm run dev` kullanın.

Kontroller:

```bash
npm run typecheck   # tsc --noEmit
npm run build       # production build -> dist/ + server/build/engine.cjs (sinyal motoru)
```

Her push'ta aynı kontroller GitHub Actions ile çalışır (`.github/workflows/ci.yml`).

## Deploy (Hostinger, tek origin)

1. `npm run build` ile `dist/` klasörünü ve sinyal motoru paketini (`server/build/engine.cjs`) üretin.
2. Projeyi (`dist/` ve `server/build/` dahil) sunucuya yükleyin, `npm ci --omit=dev` çalıştırın.
3. Ortam değişkenlerini hosting panelinde tanımlayın (`NODE_ENV=production`, `JWT_SECRET`, `WEBHOOK_SECRET`, `ALLOWED_ORIGINS`, DB değişkenleri, `GEMINI_API_KEY`).
4. Uygulamayı `npm start` ile başlatın. `dist/` mevcutsa backend onu statik olarak sunar ve SPA yönlendirmesini yapar; `VITE_API_URL` boş kalabilir.

Frontend'i ayrı bir statik sunucuda (Apache) barındırıyorsanız `public/.htaccess` SPA yönlendirmesini ve güvenlik
başlıklarını içerir. Bu durumda build öncesinde `VITE_API_URL` ile backend adresini verin ve backend'de
`ALLOWED_ORIGINS` değişkenini ayarlayın.

## TradingView webhook

Yönetici hesabıyla uygulamadaki **Webhook** görünümünü açın; gizli anahtarı (sunucudaki `WEBHOOK_SECRET` ile aynı)
girip hazır alarm şablonlarını kopyalayın. Webhook adresi: `https://<alanadınız>/api/webhook`.

## Sinyal motoru

Üç sinyal motoru (24s momentum, 1s hacim, negatif fonlama rejimi) tarayıcıda değil, Node sürecinde 7/24 tek yerde
çalışır: Binance akışlarını (`ws` paketiyle) dinler, sinyalleri MySQL'e yazar (`signals` + `signal_meta`), socket.io ile
açık tüm tarayıcılara yayınlar; böylece her cihaz aynı sinyalleri görür. Motor çekirdeği `engine/` klasöründedir
(TypeScript, Express/DB bağımsız); `npm run build` (veya yalnızca `npm run build:engine`) onu `server/build/engine.cjs`
olarak paketler. Paket yoksa sunucu uyarı verir ve motor olmadan çalışmaya devam eder.

| Değişken | Açıklama |
| --- | --- |
| `ENGINE_MODE` | `server` (varsayılan): motor bu süreçte çalışır. `off`: motor kapalı (API çalışmaya devam eder) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | İkisi birlikte tanımlıysa motor sinyalleri bu sohbete **sunucudan bir kez** gönderilir (en fazla 20 mesaj/dk, token loglanmaz) |
| `TELEGRAM_MIN_PRIORITY` | `LOW`, `MEDIUM` (varsayılan) veya `HIGH`. Momentum ve fonlama `LOW`, hacim `MEDIUM` önceliklidir |

- **Tek motor:** Motoru yalnızca MySQL kilidini (`GET_LOCK('fidelio_engine')`, ayrı ve havuza iade edilmeyen bir
  bağlantıda) tutan süreç çalıştırır. İkinci bir süreç (ör. yeniden deploy sırasında eskisiyle çakışan) beklemede kalır ve
  60 sn'de bir yeniden dener; böylece sinyaller iki kez üretilmez. `SIGTERM`/`SIGINT` gelince kilit bırakılır.
  Lider süreç kilidi 5 sn'de bir doğrular; kilit bağlantısı koparsa veya sorgu 10 sn içinde yanıt vermezse motoru hemen
  durdurur ve kilidi yeniden dener.
- **Birden fazla süreç:** Hostinger uygulamayı aynı anda birkaç Node süreci olarak çalıştırır; her tarayıcı birine bağlı kalır.
  Her süreç 3 sn'de bir diğer süreçlerin kaydettiği yeni sinyalleri ve silmeleri (`engine_state`: `signals_deleted`,
  `signals_cleared_at`) okuyup kendi tarayıcılarına bir kez iletir; yeni açılan süreç eski sinyalleri tekrar göndermez. Lider
  5 sn'de bir `engine_state.leader` kalp atışı yazar; bekleyen süreç durumu onunla verir (`servedBy`, 20 sn'den eskiyse `leaderStale`).
- **Yerel geliştirme:** Yerel `.env` üretim veritabanına bağlanıyorsa oraya `ENGINE_MODE=off` ekleyin. Aksi halde
  kilidi yerel süreç alabilir; o zaman motor sizin bilgisayarınızda çalışır ve canlı sinyaller yalnızca yerel sunucuya
  bağlı tarayıcılara yayınlanır (bilgisayar uykuya geçerse kilit, MySQL bağlantıyı kapatana kadar bırakılmaz).
- **Durum tabloları:** `engine_state` (genel ayarlar, bekleme süreleri, son 50 süreç başlangıcı) ve `signal_meta`
  (sinyalin motoru ve ölçümü) başlangıçta `CREATE TABLE IF NOT EXISTS` ile oluşturulur (bkz. `server/schema.sql`).
  Yetki yoksa motor durumu bellekte tutulur.
- **Yeniden başlatma:** Bekleme süreleri en fazla 10 sn'de bir kaydedilip açılışta geri yüklenir; her motorun ilk
  taraması yalnızca mevcut durumu kaydeder. Yeniden başlatma aynı sinyali tekrar duyurmaz.
- **Ayarlar:** Herkes için ortaktır; yönetici `PUT /api/engine/settings` ile değiştirir (değerler sınırlara çekilir,
  eşik değişikliği motoru sessizce yeniden başlatır, sinyal yağmuru olmaz).
- **Durum:** `GET /api/engine/status` (giriş yapmış her kullanıcı): `mode`, `running`, `role` (`leader` / `standby` / `off`),
  `startedAt`, `uptimeSec` (süreç çalışma süresi), `processStartedAt`, `boots` (son 50 başlangıç zamanı), dört akışın
  durumu (`spotMini`, `spotHour`, `futuresMark`, `futuresMini`: `connected` / `connecting` / `down`), motor başına son
  tarama zamanı (`lastScan`), eşiği aşan sembol / evren sayıları (`stats`), geçerli ayarlar, negatif fonlama kapısındaki
  kontratlar (`activeFunding`, `f8` kesir olarak), `telegram.server` ve bugün (00:00 UTC'den beri) üretilen motor sinyali
  sayısı (`signalsToday`). Hosting'in süreci ayakta tutup tutmadığı `boots` ve `uptimeSec` ile izlenir; her başlangıç
  ayrıca `[engine] Süreç başlangıcı kaydedildi` satırıyla loglanır.
