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
npm run build       # production build -> dist/
```

Her push'ta aynı kontroller GitHub Actions ile çalışır (`.github/workflows/ci.yml`).

## Deploy (Hostinger, tek origin)

1. `npm run build` ile `dist/` klasörünü üretin.
2. Projeyi (`dist/` dahil) sunucuya yükleyin, `npm ci --omit=dev` çalıştırın.
3. Ortam değişkenlerini hosting panelinde tanımlayın (`NODE_ENV=production`, `JWT_SECRET`, `WEBHOOK_SECRET`, `ALLOWED_ORIGINS`, DB değişkenleri, `GEMINI_API_KEY`).
4. Uygulamayı `npm start` ile başlatın. `dist/` mevcutsa backend onu statik olarak sunar ve SPA yönlendirmesini yapar; `VITE_API_URL` boş kalabilir.

Frontend'i ayrı bir statik sunucuda (Apache) barındırıyorsanız `public/.htaccess` SPA yönlendirmesini ve güvenlik
başlıklarını içerir. Bu durumda build öncesinde `VITE_API_URL` ile backend adresini verin ve backend'de
`ALLOWED_ORIGINS` değişkenini ayarlayın.

## TradingView webhook

Yönetici hesabıyla uygulamadaki **Webhook** görünümünü açın; gizli anahtarı (sunucudaki `WEBHOOK_SECRET` ile aynı)
girip hazır alarm şablonlarını kopyalayın. Webhook adresi: `https://<alanadınız>/api/webhook`.
