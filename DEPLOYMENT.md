# Deployment

> **Verification status (2026-09-28).** Verified locally: `npm start` on Node 24 with embedded PGlite
> (Windows 11). Verified in CI (GitHub Actions, Ubuntu): the full test suite against **PostgreSQL 17**, and
> the **docker-compose stack** (image build, start, readiness on PostgreSQL, first-run setup, a real
> outbound check from the container, restart with data persisted, container health check).
> Not done: any cloud deployment; load testing.

## Topology

One Node.js process serves the API, the UI and runs background jobs. State lives in PostgreSQL.

```
Internet ─► TLS reverse proxy (Caddy/nginx/Traefik) ─► ContractRift :3000 ─► PostgreSQL
                                                          └──► monitored upstreams / webhooks
```

## Development

See [INSTALLATION.md](INSTALLATION.md): `npm ci && npm run build && npm start` or `npm run dev`.

## Production checklist

1. **PostgreSQL** database and user; set `DATABASE_URL`.
2. `ENCRYPTION_KEY` from `npm run gen-key`, stored in your secret manager **and** backed up.
3. `NODE_ENV=production`, `APP_URL=https://contractrift.example.com`.
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
docker compose logs -f contractrift
```

The image (`Dockerfile`) is multi-stage on `node:24-bookworm-slim`, runs as the non-root `node`
user, exposes 3000, declares a `HEALTHCHECK` on `/readyz`, and applies migrations at startup.

Without PostgreSQL (single node, small installs):

```bash
docker build -t contractrift .
docker run -d -p 3000:3000 -v contractrift-data:/data \
  -e ENCRYPTION_KEY=... -e APP_URL=https://contractrift.example.com contractrift
```

Data then lives in the `/data` volume (PGlite). PGlite is single-connection; use PostgreSQL for
larger installs or more than one instance.

## Google Cloud free tier (what runs the public demo)

The public demo (https://136-119-147-140.sslip.io) runs on a Google Cloud **e2-micro "Always Free"** VM (us-central1, 30 GB standard disk,
Debian 12): $0 for the VM, disk and external IP within the free tier; only outbound traffic above 1 GB/month is billed
(about $0.12/GB), guarded by a $5 budget alert. [`deploy/gcp/startup.sh`](deploy/gcp/startup.sh) installs Docker, adds
1 GB swap and runs the released image behind Caddy (automatic Let's Encrypt HTTPS on an `<ip>.sslip.io` host name).

```bash
gcloud compute firewall-rules create contractrift-web --allow tcp:80,tcp:443 --target-tags contractrift-web
gcloud compute instances create contractrift --zone us-central1-a --machine-type e2-micro \
  --image-family debian-12 --image-project debian-cloud --boot-disk-size 30GB --boot-disk-type pd-standard \
  --tags contractrift-web --metadata-from-file startup-script=deploy/gcp/startup.sh,encryption-key=ek.txt,setup-token=st.txt
# after the first successful boot the secrets live in /opt/contractrift/secrets.env (root-only):
gcloud compute instances remove-metadata contractrift --zone us-central1-a --keys encryption-key,setup-token
```

Upgrade: bump `CONTRACTRIFT_VERSION` in the script, run `gcloud compute instances add-metadata ... startup-script=...`, then
`gcloud compute instances reset contractrift` (keeps the IP; a stop/start could change it and therefore the host name).
Logs: `gcloud compute ssh contractrift --tunnel-through-iap --command "sudo docker logs contractrift-app-1"`.
Limits: 1 GB RAM (the app uses about 300-400 MB), embedded database, single instance.

## Render (one click)

`render.yaml` defines a Docker web service (0.5 CPU / 512 MB, ≈ $7/month) and a managed PostgreSQL 17
database (≈ $6/month) — list prices checked 2026-09-28. Render generates `ENCRYPTION_KEY` and `SETUP_TOKEN`,
wires `DATABASE_URL`, and sets `RENDER_EXTERNAL_URL` (used as `APP_URL`).

1. Open https://render.com/deploy?repo=https://github.com/ahmedgcompany-cyber/contractrift (or the button in the README).
2. When asked for `DEMO_MODE`, enter `true` for a public read-only demo or `false` for a private install.
3. After the first deploy, open the service's **Environment** tab, copy `SETUP_TOKEN`, open the service URL and
   create the admin account with it. Also copy `ENCRYPTION_KEY` into your password manager.

Free Render plans are not suitable: free web services sleep (so checks stop) and free databases expire.

## Bare metal / VM (systemd)

```bash
npm ci && npm run build && npm prune --omit=dev
```

```ini
# /etc/systemd/system/contractrift.service
[Service]
WorkingDirectory=/opt/contractrift
EnvironmentFile=/etc/contractrift.env
ExecStart=/usr/bin/node backend/dist/index.js
User=contractrift
Restart=on-failure
```

The process handles `SIGTERM`: stops scheduling, waits up to 15 s for in-flight checks, closes
the server and database.

## Reverse proxy example (Caddy)

```
contractrift.example.com {
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
