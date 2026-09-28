# Deployment

> **Verification status (2026-09-28).** Verified locally: `npm start` on Node 24 with embedded PGlite
> (Windows 11). Verified in CI (GitHub Actions, Ubuntu): the full test suite against **PostgreSQL 17**, and
> the **docker-compose stack** (image build, start, readiness on PostgreSQL, first-run setup, a real
> outbound check from the container, restart with data persisted, container health check).
> Not done: any cloud deployment; load testing.

## Topology

One Node.js process serves the API, the UI and runs background jobs. State lives in PostgreSQL.

```
Internet ─► TLS reverse proxy (Caddy/nginx/Traefik) ─► Tripline :3000 ─► PostgreSQL
                                                          └──► monitored upstreams / webhooks
```

## Development

See [INSTALLATION.md](INSTALLATION.md): `npm ci && npm run build && npm start` or `npm run dev`.

## Production checklist

1. **PostgreSQL** database and user; set `DATABASE_URL`.
2. `ENCRYPTION_KEY` from `npm run gen-key`, stored in your secret manager **and** backed up.
3. `NODE_ENV=production`, `APP_URL=https://tripline.example.com`.
4. Serve over **HTTPS** via a reverse proxy; keep `COOKIE_SECURE=true` (default in production);
   set `TRUST_PROXY=true` so rate limits and audit logs see real client IPs.
5. Leave `ALLOW_PRIVATE_TARGETS=false` unless you must monitor internal services
   (then restrict egress at the network level — see SECURITY.md).
6. Health checks: liveness `GET /healthz`, readiness `GET /readyz`.
7. Back up the database (and PGlite directory if used).

## Docker (single container + PostgreSQL)

```bash
cp .env.example .env
# set ENCRYPTION_KEY and add POSTGRES_PASSWORD=<strong password>
docker compose up -d --build
docker compose logs -f tripline
```

The image (`Dockerfile`) is multi-stage on `node:24-bookworm-slim`, runs as the non-root `node`
user, exposes 3000, declares a `HEALTHCHECK` on `/readyz`, and applies migrations at startup.

Without PostgreSQL (single node, small installs):

```bash
docker build -t tripline .
docker run -d -p 3000:3000 -v tripline-data:/data \
  -e ENCRYPTION_KEY=... -e APP_URL=https://tripline.example.com tripline
```

Data then lives in the `/data` volume (PGlite). PGlite is single-connection; use PostgreSQL for
larger installs or more than one instance.

## Bare metal / VM (systemd)

```bash
npm ci && npm run build && npm prune --omit=dev
```

```ini
# /etc/systemd/system/tripline.service
[Service]
WorkingDirectory=/opt/tripline
EnvironmentFile=/etc/tripline.env
ExecStart=/usr/bin/node backend/dist/index.js
User=tripline
Restart=on-failure
```

The process handles `SIGTERM`: stops scheduling, waits up to 15 s for in-flight checks, closes
the server and database.

## Reverse proxy example (Caddy)

```
tripline.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

## Staging

Run a second instance with its own database and `ENCRYPTION_KEY`, `APP_URL` pointing at the
staging host, and notification channels pointing at a test Slack channel/webhook sink. Point
monitors at provider sandbox endpoints where they exist (e.g. Stripe test mode keys).

## Scaling

- Multiple instances against **one PostgreSQL** are designed to be safe: monitors and outbox rows
  are claimed with `FOR UPDATE SKIP LOCKED`, and each check is recorded in a transaction with a
  row lock. **This has not been load-tested.**
- Alternatively run one instance with `SCHEDULER_ENABLED=true` and others with `false` (API only).
- Measured locally (PGlite, 200 monitors × 30 results): `GET /monitors` median 31 ms, 250 KB payload.

## Upgrades & migrations

Migrations in `database/migrations` run automatically at startup (idempotent; tracked in
`drizzle.__drizzle_migrations`). To run them separately: `npm run db:migrate`.

1. Back up the database.
2. Deploy the new version; it migrates on boot.
3. Watch `/readyz` and logs.

## Rotating ENCRYPTION_KEY

1. `npm run gen-key` → new key.
2. Set `ENCRYPTION_KEY=<new>` and `ENCRYPTION_KEY_PREVIOUS=<old>` (comma-separate several old keys).
3. Restart. At startup every monitor secret and channel URL/secret is re-encrypted with the new key
   (log line `secrets re-encrypted…`, audit action `secrets.reencrypted`). Or run `npm run rotate-key -w backend`
   (exit code 1 if any value can't be decrypted with any configured key).
4. When the report shows `failed: 0`, remove `ENCRYPTION_KEY_PREVIOUS` and restart.

With several instances, give all of them both keys before restarting any.

## Rollback

Migrations are forward-only. To roll back application code across a schema change, restore the
pre-upgrade database backup together with the previous version. Rolling back code **without** a
schema change is just redeploying the previous build.

## CI/CD

`.github/workflows/ci.yml` runs on push/PR: lint, typecheck, unit/integration tests (PGlite),
integration tests against PostgreSQL 17, Playwright E2E, `npm audit` for production deps, and a
Docker build. There is **no deployment workflow**: deployment targets and their secrets do not
exist yet. Required secrets for a future deploy job would be the registry credentials and the
target environment's `DATABASE_URL`/`ENCRYPTION_KEY`.
