# Installation

## Requirements

| Requirement | Version                                                     | Notes                                                 |
| ----------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| Node.js     | 22.12+ (developed and tested on 24.14)                      | `node -v`                                             |
| npm         | 10+ (tested with 11.19)                                     | ships with Node                                       |
| PostgreSQL  | 14+ recommended (CI targets 17)                             | **optional** — without it the embedded PGlite is used |
| OS          | Windows 11 (tested), Linux/macOS (expected; CI runs Ubuntu) |                                                       |

No compiler toolchain is needed: native dependencies (`@node-rs/argon2`, PGlite WASM) ship
prebuilt.

## 1. Get the code and install

```bash
git clone <your-repo-url> tripline
cd tripline
npm ci
```

## 2. Configure

```bash
cp .env.example .env
npm run gen-key
```

Paste the printed key into `ENCRYPTION_KEY=` in `.env`. **Back this key up.** It encrypts
stored API keys and webhook URLs; if it is lost those secrets must be re-entered.

Optional: set `DATABASE_URL=postgres://user:pass@host:5432/tripline` to use PostgreSQL. Every
variable is explained in [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md#environment-variables).

## 3. Build and start

```bash
npm run build     # builds frontend/dist and backend/dist
npm start         # applies database migrations, then serves on PORT (default 3000)
```

Open `http://localhost:3000`. The first visit shows **Create the administrator account**; this
works only while no users exist.

## 4. Verify

```bash
curl http://localhost:3000/healthz    # {"status":"ok"}
curl http://localhost:3000/readyz     # {"status":"ready","database":"pglite"|"pg"}
```

## Development mode (hot reload)

```bash
npm run dev          # backend on :3000 with tsx watch
npm run dev:web      # Vite on :5173, proxies /api to :3000
```

Open `http://localhost:5173`. For the CSRF origin check to accept requests from Vite, set
`APP_URL=http://localhost:5173` in `.env` while developing this way.

## Monitoring internal services

By default Tripline refuses to connect to private, loopback and link-local addresses (SSRF
protection). If you intentionally monitor services on your private network, set
`ALLOW_PRIVATE_TARGETS=true` and read [SECURITY.md](SECURITY.md#ssrf) first.

## Docker

See [DEPLOYMENT.md](DEPLOYMENT.md). The docker-compose stack (app + PostgreSQL 17) is built, started
and exercised in CI on every push.
