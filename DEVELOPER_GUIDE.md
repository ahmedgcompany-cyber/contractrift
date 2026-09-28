# Developer Guide

## Repository layout

```
tripline/
├── backend/                 Fastify API, probes, drift engine, jobs (TypeScript, ESM)
│   ├── src/
│   │   ├── index.ts         process entry (config → DB → migrate → app → listen → jobs)
│   │   ├── app.ts           buildApp(): plugins, routes, static SPA, OpenAPI
│   │   ├── config.ts        env parsing/validation
│   │   ├── db/              schema.ts (Drizzle), client.ts (pg | PGlite), migrate-cli.ts
│   │   ├── drift/           shape inference, diff/severity, accept (pure functions)
│   │   ├── probes/          http.ts, llm.ts, mcp.ts, assertions.ts, config.ts (TypeBox schemas)
│   │   ├── services/        business logic (no Fastify types)
│   │   ├── routes/          HTTP layer + response schemas (schemas.ts)
│   │   ├── plugins/         auth/CSRF/roles, error handler
│   │   ├── jobs/            scheduler, outbox delivery, retention
│   │   ├── lib/             crypto, SSRF-guarded HTTP client, JSONPath, errors
│   │   └── cli/             reset-password
│   └── test/
│       ├── unit/            pure logic
│       ├── integration/     API + DB + real local upstream servers
│       └── support/         harness.ts, upstreams.ts (test-substitute servers), run-upstreams.ts
├── frontend/                React 19 SPA (Vite); src/pages, src/components, api.ts, styles.css
├── database/
│   ├── migrations/          generated SQL (drizzle-kit) — applied at startup
│   ├── schema/README.md     pointer to backend/src/db/schema.ts
│   └── seeds/demo.ts        optional demo monitors
├── api/openapi.yaml         generated from route schemas (tested for drift)
├── tests/e2e/               Playwright specs
├── scripts/                 gen-key.mjs, tripline-gate.mjs
├── research/                problem & competitor research
└── .github/workflows/ci.yml
```

## Commands

| Task                     | Command                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------ |
| Install                  | `npm ci`                                                                             |
| Dev (API, watch)         | `npm run dev`                                                                        |
| Dev (UI, Vite :5173)     | `npm run dev:web`                                                                    |
| Build everything         | `npm run build`                                                                      |
| Start built app          | `npm start`                                                                          |
| Typecheck                | `npm run typecheck`                                                                  |
| Lint + format check      | `npm run lint`                                                                       |
| Format                   | `npm run format`                                                                     |
| Unit + integration tests | `npm test` (or `npm run test:unit`, `npm run test:integration`)                      |
| E2E tests                | `npm run build && npm run test:e2e` (`PW_CHANNEL=chrome` to use installed Chrome)    |
| Generate a migration     | edit `backend/src/db/schema.ts`, then `npm run db:generate`                          |
| Apply migrations         | `npm run db:migrate` (also automatic at startup)                                     |
| Regenerate OpenAPI       | `npm run openapi`                                                                    |
| Local fake upstreams     | `npm run upstreams -w backend` (port 4010, `UPSTREAMS_PORT` to change)               |
| Demo data                | `npm run seed:demo -w backend -- --upstreams http://127.0.0.1:4010` or `-- --public` |
| Admin password recovery  | `npm run reset-password -w backend -- <email>`                                       |
| Encryption key           | `npm run gen-key`                                                                    |

## Environment variables

Read once at startup by `backend/src/config.ts`; invalid values stop the process with exit code 2.

| Variable                | Default                   | Description                                                                                      |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| `ENCRYPTION_KEY`        | **required**              | 32 bytes, base64. AES-256-GCM key for monitor secrets and channel URLs.                          |
| `NODE_ENV`              | `development`             | `development` \| `production` \| `test`. Production defaults cookies to Secure.                  |
| `HOST`                  | `0.0.0.0`                 | Listen address.                                                                                  |
| `PORT`                  | `3000`                    | Listen port.                                                                                     |
| `APP_URL`               | `http://localhost:$PORT`  | Public URL: notification links and CSRF `Origin` check.                                          |
| `DATABASE_URL`          | —                         | PostgreSQL URL. Empty → embedded PGlite.                                                         |
| `PGLITE_DATA_DIR`       | `./data/pglite`           | PGlite directory; `memory://` for in-memory.                                                     |
| `SESSION_TTL_HOURS`     | `168`                     | Sliding session lifetime (1 – 2160).                                                             |
| `COOKIE_SECURE`         | `true` in production      | Secure flag on the session cookie (needs HTTPS).                                                 |
| `TRUST_PROXY`           | `false`                   | Trust `X-Forwarded-*` (set behind a reverse proxy, for correct client IPs in rate limits/audit). |
| `LOG_LEVEL`             | `info` (`silent` in test) | pino level.                                                                                      |
| `ALLOW_PRIVATE_TARGETS` | `false`                   | Allow probes/webhooks to private, loopback, link-local addresses.                                |
| `SCHEDULER_ENABLED`     | `true`                    | Run background jobs in this process.                                                             |
| `SCHEDULER_CONCURRENCY` | `8`                       | Max checks in flight per process.                                                                |
| `SCHEDULER_TICK_MS`     | `5000`                    | How often due monitors are claimed.                                                              |
| `RETENTION_DAYS`        | `30`                      | Check results and finished deliveries older than this are deleted hourly.                        |
| `FRONTEND_DIST`         | `frontend/dist`           | Built UI directory; empty = API only.                                                            |

Test/tooling only: `TEST_DATABASE_URL` (run integration tests against real PostgreSQL — the
schema is **dropped** each run), `UPSTREAMS_PORT`, `PW_CHANNEL`, `CI`. Gate script:
`TRIPLINE_URL`, `TRIPLINE_TOKEN`.

## Conventions

- **Layering:** routes → services → db. Services take a `Ctx` (`db`, `config`, `log`) and an
  `Actor`; they never import Fastify. Probes and the drift engine are pure/IO-isolated.
- **Validation:** request bodies via TypeBox route schemas (unknown fields are rejected);
  kind-specific monitor config via `normalizeConfig()` in `probes/index.ts`.
- **Errors:** throw `AppError(code, message, details?)` (`lib/errors.ts`); the error handler
  renders `{ error: { code, message, request_id, details? } }`.
- **Responses:** every route has a response schema — only listed fields are serialized. Adding a
  field to a response means adding it to `routes/schemas.ts` (and regenerating OpenAPI).
- **Secrets:** never log, never return. Store via `encryptJson`. Redact excerpts with `redactExcerpt`.
- **Audit:** state-changing service functions call `audit()`; never put secret values in `details`.
- **ESM + NodeNext:** relative imports use `.js` extensions in backend TypeScript.
- **Style:** Prettier (single quotes, width 140), ESLint recommended + typescript-eslint.

## Testing notes

- Integration tests use `createHarness()` (fresh in-memory PGlite + `buildApp`) and `Client`
  (keeps cookies, sends the CSRF header). Upstreams are real HTTP servers from
  `test/support/upstreams.ts`; they reproduce the documented OpenAI, Anthropic and MCP formats
  but are **not** the real providers.
- `jobs.test.ts` asserts that `api/openapi.yaml` equals the generated document; run
  `npm run openapi` after changing route schemas.
- E2E (`tests/e2e`) runs the **built** app with `PGLITE_DATA_DIR=memory://` on port 3310 and the
  upstreams on 4011 (see `playwright.config.ts`).

## Adding things

- **API endpoint:** add to the matching `routes/*.ts` with `config.role`, params/body/response
  schemas; logic in a service; test in `test/integration`; `npm run openapi`; update
  API_DOCUMENTATION.md.
- **Table/column:** edit `db/schema.ts` → `npm run db:generate` → review SQL in
  `database/migrations` → update DATABASE.md. Never edit an applied migration.
- **Monitor kind:** config schema + defaults in `probes/config.ts`, validation in
  `normalizeConfig`, probe returning `ProbeOutcome` (set `observed` only for "normal"
  responses), dispatch in `runProbe`, enum in `schema.ts` (migration), UI fields in
  `MonitorForm.tsx`.
- **Notification channel type:** `channelKind` enum + migration, formatting in `send()` in
  `services/notifications.ts`, UI in `Settings.tsx`.
