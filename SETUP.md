# OpenClaw Instagram Admin — Kos-Kosan Putri

Bot otomatis untuk menjawab DM Instagram bisnis kos-kosan putri menggunakan AI.

## Arsitektur

```
Instagram DM → Facebook Webhook → OpenClaw Gateway → OpenRouter (Free LLM) → Reply ke Instagram DM
```

- **Channel**: Instagram Messenger Platform (webhook-based)
- **AI Model**: OpenRouter free models (Llama 3.3 70B, Qwen3, Mistral)
- **Skill**: `ig-kos-admin` — panduan respons Bahasa Indonesia untuk kos-kosan putri
- **Privacy**: Tools disabled, hanya plugin Instagram yang aktif, skill terbatas

## Prasyarat

1. **Node.js 22+**
2. **pnpm** (package manager)
3. **Akun Instagram Professional** (Business atau Creator)
4. **Meta Developer Account** + Facebook App
5. **OpenRouter API Key** (gratis di https://openrouter.ai/keys)
6. **HTTPS endpoint** (untuk webhook — gunakan ngrok untuk development)

## Setup Step-by-Step

### 1. Clone & Install

```bash
git clone <repo-url> openclaw-ig-admin
cd openclaw-ig-admin
pnpm install
```

### 2. Setup Facebook App

1. Buka https://developers.facebook.com/apps/ dan buat App baru (tipe: Business)
2. Tambahkan produk **Messenger**
3. Di Settings > Instagram Messaging, hubungkan Instagram Professional account
4. Generate **Page Access Token** dengan permission `instagram_manage_messages`
5. Catat:
   - **Page Access Token**
   - **Page ID** (dari Facebook Page yang terhubung ke IG)
   - **App Secret** (dari Settings > Basic)

### 3. Konfigurasi Environment

```bash
cp .env.ig-admin .env
```

Edit `.env` dan isi:

```env
OPENROUTER_API_KEY=sk-or-...your-key...
INSTAGRAM_PAGE_ACCESS_TOKEN=EAAxxxxx...
INSTAGRAM_PAGE_ID=123456789
INSTAGRAM_WEBHOOK_VERIFY_TOKEN=my-random-secret-123
INSTAGRAM_APP_SECRET=abcdef123456
```

### 4. Edit Business Rulebook

Edit file `skills/ig-kos-admin/SKILL.md` bagian **Data Bisnis**:
- Ganti semua placeholder `[Contoh: ...]` dengan data kos-kosan Anda
- Update lokasi, fasilitas, harga, aturan, dll.

### 5. Jalankan Gateway

```bash
# Development (dengan HTTPS tunnel)
npx ngrok http 18789  # di terminal terpisah, catat URL HTTPS

# Jalankan gateway
pnpm openclaw gateway run --port 18789
```

### 6. Setup Webhook di Facebook

1. Buka App Dashboard > Messenger > Instagram Settings > Webhooks
2. Callback URL: `https://your-ngrok-url.ngrok.io/webhook/instagram`
3. Verify Token: isi sama dengan `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` di `.env`
4. Subscribe ke events: `messages`, `messaging_postbacks`
5. Klik **Verify and Save**

### 7. Test

Kirim DM ke akun Instagram Business Anda dari akun lain. Bot akan merespons otomatis.

## Kustomisasi Skill

### Mengubah Respons

Edit `skills/ig-kos-admin/SKILL.md` — ini adalah "buku panduan" yang diikuti oleh AI.

Anda bisa mengubah:
- Template respons (greeting, info lokasi, harga, dll.)
- Data bisnis (lokasi, fasilitas, harga)
- Aturan kos
- Nada bicara dan bahasa
- Batasan (apa yang boleh/tidak boleh dijawab)

### Menambah Skill Baru

Buat folder baru di `skills/`:

```
skills/nama-skill-baru/SKILL.md
```

Lalu tambahkan ke `openclaw.json`:

```json
"skills": {
  "allowBundled": ["ig-kos-admin", "nama-skill-baru"]
}
```

## Keamanan & Privasi

Konfigurasi ini sudah di-lock down:

- **Tools disabled**: AI tidak bisa menjalankan perintah/tool apapun
- **Plugin terbatas**: Hanya plugin Instagram yang aktif
- **Skill terbatas**: Hanya skill `ig-kos-admin` yang dimuat
- **No browser/file access**: AI tidak bisa mengakses browser atau file system
- **Webhook signature verification**: Request dari Facebook diverifikasi via X-Hub-Signature-256
- **DM policy**: Dapat diatur ke `allowlist` untuk membatasi siapa yang bisa chat

### Tips Keamanan Tambahan

1. Gunakan Page Access Token dengan permission minimum
2. Rotasi App Secret secara berkala
3. Set `dmPolicy: "allowlist"` dan isi `allowFrom` dengan IGSID yang diizinkan jika ingin membatasi
4. Jangan commit file `.env` ke git
5. Gunakan HTTPS untuk webhook (wajib oleh Facebook)

## Model AI

Menggunakan OpenRouter free models (tanpa biaya):

| Model | Konteks | Keunggulan |
|-------|---------|------------|
| Llama 3.3 70B (primary) | 128K | General purpose, kuat Bahasa Indonesia |
| Qwen3 235B (fallback) | 262K | Reasoning kuat |
| Mistral Small 3.1 24B (fallback) | 128K | Cepat, efisien |

Rate limit free tier: 20 request/menit, 200 request/hari per model.

## Running with Docker (Recommended)

Docker provides **strong security isolation** — the bot runs in a locked-down container that:

| Protection | What it prevents |
|-----------|-----------------|
| **Read-only filesystem** | Bot cannot modify its own code or install malware |
| **All capabilities dropped** | No kernel-level privileges (mount, network admin, etc.) |
| **No privilege escalation** | Setuid binaries cannot gain root |
| **Non-root user** | Process runs as unprivileged `igadmin` user |
| **Memory/CPU limits** | Cannot exhaust host resources (512MB / 1 CPU) |
| **tmpfs only for /tmp** | Temp files are noexec and limited to 64MB |
| **No host devices** | Cannot access host hardware |
| **Isolated network** | Only outbound to internet (Graph API + OpenRouter) |

### Quick Start (Docker)

```bash
# 1. Setup environment
cp .env.ig-admin .env
# Edit .env with your credentials

# 2. Edit your business rulebook
# Edit skills/ig-kos-admin/SKILL.md with your kos data

# 3. Build and start
./scripts/docker-ig-admin.sh build
./scripts/docker-ig-admin.sh start

# 4. View logs
./scripts/docker-ig-admin.sh logs

# 5. Stop
./scripts/docker-ig-admin.sh stop
```

### Docker Commands

```bash
./scripts/docker-ig-admin.sh build     # Build image
./scripts/docker-ig-admin.sh start     # Start container
./scripts/docker-ig-admin.sh stop      # Stop container
./scripts/docker-ig-admin.sh restart   # Restart
./scripts/docker-ig-admin.sh logs      # Follow logs
./scripts/docker-ig-admin.sh status    # Check status
./scripts/docker-ig-admin.sh clean     # Remove container + data
```

### Updating the Skill Without Rebuilding

The skill directory is mounted as a read-only volume. To update responses:

1. Edit `skills/ig-kos-admin/SKILL.md` on your host
2. Restart: `./scripts/docker-ig-admin.sh restart`

No rebuild needed — the container picks up the updated skill on restart.

### Docker + ngrok for Development

```bash
# Terminal 1: Start the bot
./scripts/docker-ig-admin.sh start

# Terminal 2: Expose via ngrok
ngrok http 18789

# Use the ngrok HTTPS URL as your Facebook webhook callback URL
```

### Production Deployment

For production, you can deploy this to any Docker-compatible platform:

- **VPS** (DigitalOcean, Linode, Hetzner): `docker compose -f docker-compose.ig-admin.yml up -d`
- **Railway/Render**: Point to the `Dockerfile.ig-admin`
- **Fly.io**: `fly launch --dockerfile Dockerfile.ig-admin`

Make sure your deployment has a stable HTTPS URL for the Facebook webhook.

## Troubleshooting

### Webhook tidak terverifikasi
- Pastikan gateway sudah running
- Pastikan URL ngrok benar dan HTTPS
- Pastikan `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` sama di `.env` dan Facebook dashboard

### Bot tidak merespons
- Cek log gateway: `tail -f /tmp/openclaw-gateway.log`
- Pastikan `INSTAGRAM_PAGE_ACCESS_TOKEN` valid
- Pastikan Instagram account sudah terhubung ke Facebook Page
- Cek App mode (Development vs Live) — Development hanya bisa chat dengan app role

### Rate limited
- Free models punya limit 20 req/menit
- Jika banyak DM masuk bersamaan, sebagian akan menggunakan fallback model
