# Architecture

## 1. Overview

```
                         ┌────────────────────────── Tripline process (Node.js 24) ───────────────────────────┐
 Browser (React SPA) ──► │ Fastify HTTP server                                                               │
 CI / scripts (token) ─► │   ├─ /api/v1/*  routes → services (business logic) → Drizzle ORM ─────────────┐    │
                         │   ├─ /api/docs  OpenAPI (generated from route schemas)                        │    │
                         │   └─ /*         static frontend (frontend/dist) with SPA fallback             │    │
                         │                                                                               ▼    │
                         │ Scheduler (tick)  ─ claims due monitors (FOR UPDATE SKIP LOCKED) ─► PostgreSQL     │
                         │   └─ Runner ─ probes (http / llm / mcp) ─► guarded HTTP client ─► upstreams        │
                         │        └─ assertions, drift engine, incident logic, outbox insert                  │
                         │ Notifier (tick)   ─ drains notification outbox ─► webhook / Slack                  │
                         │ Retention (hourly) ─ prunes old results, deliveries, expired sessions              │
                         └───────────────────────────────────────────────────────────────────────────────────┘
 PostgreSQL = external server via DATABASE_URL (production)  |  embedded PGlite in ./data (dev, tests, single-node)
```

A single deployable process. Background work runs in-process on timers; there is no separate
queue broker because PostgreSQL itself provides the durable queue semantics needed (row
claiming with `SKIP LOCKED`, an outbox table for notifications).

## 2. Technology decisions

| Area                    | Choice                                                                                        | Why                                                                                                                                             | Alternatives considered                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Language                | TypeScript 6.0 (strict) end-to-end                                                            | One language for UI, API, probes; TS 6 is the last JS-based compiler, so ESLint/typescript-eslint and editor tooling work (TS 7 is native-only) | Go (great for probes, weaker UI story in one repo); Python/FastAPI; TypeScript 7 (no JS API → breaks typescript-eslint)                         |
| Runtime                 | Node.js 24 LTS                                                                                | Available; built-in `fetch`/undici, `node:crypto`, `net.BlockList`                                                                              | Bun/Deno (smaller ecosystem for ops)                                                                                                            |
| HTTP framework          | Fastify 5                                                                                     | Mature, fast, first-class JSON-Schema validation, pino logging, plugin ecosystem (helmet, rate-limit, cookie, static, swagger)                  | Express (no built-in validation), Hono, NestJS (heavier)                                                                                        |
| Validation / API schema | TypeBox via `@fastify/type-provider-typebox`                                                  | Same schema validates requests, types handlers, and generates OpenAPI → docs can't drift from code                                              | Zod + type provider                                                                                                                             |
| Database                | PostgreSQL                                                                                    | Reliable, `jsonb`, `SKIP LOCKED`, ubiquitous hosting                                                                                            | SQLite (simpler, but weaker concurrency / multi-instance story)                                                                                 |
| Embedded DB             | PGlite (Postgres→WASM)                                                                        | Zero-install dev/test with the **same SQL and migrations** as production                                                                        | Testcontainers (no Docker here)                                                                                                                 |
| ORM / migrations        | Drizzle ORM + drizzle-kit                                                                     | Typed SQL-first queries, plain SQL migration files, drivers for both `pg` and PGlite                                                            | Prisma (heavier engine, PGlite support less direct)                                                                                             |
| Password hashing        | argon2id via `@node-rs/argon2`                                                                | OWASP-recommended; prebuilt binaries                                                                                                            | bcrypt                                                                                                                                          |
| Sessions                | Server-side sessions; opaque 256-bit random token in httpOnly cookie; SHA-256 of token stored | Revocable, simple, no JWT pitfalls                                                                                                              | JWT; Better Auth (evaluated: feature-rich, but email flows/plugins not needed for admin-provisioned self-hosted accounts; adds a large surface) |
| Secrets at rest         | AES-256-GCM (`node:crypto`), key from `ENCRYPTION_KEY`                                        | Standard AEAD primitive from the standard library; no custom crypto                                                                             | libsodium                                                                                                                                       |
| JSON Schema assertions  | Ajv 8 (+ ajv-formats)                                                                         | De-facto standard                                                                                                                               | —                                                                                                                                               |
| Outbound HTTP           | undici `request` with a per-request `Agent` whose `connect.lookup` enforces SSRF policy       | Checks every connection, including redirects and DNS rebinding                                                                                  | Plain `fetch` (can't pin DNS checks)                                                                                                            |
| Frontend                | React 19 + Vite + React Router + TanStack Query, hand-written CSS                             | Mainstream, maintainable, small; no UI kit lock-in                                                                                              | Next.js (SSR unnecessary for an internal tool)                                                                                                  |
| Tests                   | Vitest (unit + integration), Playwright (E2E)                                                 | Fast, TS-native; real browser E2E                                                                                                               | Jest                                                                                                                                            |
| Lint/format             | ESLint 10 + typescript-eslint, Prettier                                                       | Pure-JS tools; mainstream                                                                                                                       | Biome (evaluated first; its unsigned native binary is blocked by Windows Application Control on the dev machine)                                |

## 3. Backend structure (`backend/src`)

| Directory   | Responsibility                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `config.ts` | Parse + validate environment variables once; typed config object                                                  |
| `app.ts`    | `buildApp(deps)` — registers plugins and routes; used by server, tests and OpenAPI export                         |
| `index.ts`  | Process entry: config → DB → migrations → app → jobs → graceful shutdown                                          |
| `db/`       | Drizzle schema, client factory (pg or PGlite), migration runner                                                   |
| `lib/`      | Cross-cutting utilities: errors, crypto, SSRF-guarded HTTP client, JSONPath subset, logger redaction              |
| `drift/`    | Pure drift engine: shape inference, baseline merge, diff + severity, acceptance                                   |
| `probes/`   | `http`, `llm`, `mcp` probes → normalized `ProbeOutcome`; shared assertions                                        |
| `services/` | Business logic (monitors, runner, incidents, drift, notifications, auth, users, tokens, audit) — no Fastify types |
| `routes/`   | HTTP layer only: schemas, auth requirements, call services, map to responses                                      |
| `plugins/`  | Fastify plugins: auth (session/token resolution, role guards, CSRF), error handler                                |
| `jobs/`     | Scheduler, notifier, retention timers                                                                             |

Rule: **routes → services → db**. Probes and the drift engine are pure/IO-isolated and unit-tested
without a database.

## 4. Data flow of one check

1. Scheduler claims up to `SCHEDULER_CONCURRENCY - running` due monitors in one
   `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING *` which also advances
   `next_run_at` (so a crash never causes a hot loop, and parallel instances never double-run).
2. Runner decrypts monitor secrets, calls the probe with a timeout.
3. Probe returns `{ ok, statusCode, durationMs, errorCode, message, assertions[], observed?, signature?, meta }`.
   `observed` is the JSON document used for structural drift; `signature` is a map of exact
   tracked values (e.g. LLM reported model, MCP required params) with a severity-on-change.
4. In one transaction: insert `check_results`; update monitor status/counters; open/resolve
   incident; learn baseline or diff against it and insert `drift_events`; insert outbox rows.
5. Notifier later delivers outbox rows with retries/backoff.

## 5. Drift engine

- **Shape** = map `path → { types:Set, count }` with paths like `$.data[].id`. Array elements are
  merged; empty arrays recorded (`emptyArray`) so their children aren't reported as removed.
- **Baseline** = merge of the first `baselineSamples` (default 3) successful observations;
  `count == samples` ⇒ required path.
- **Diff** (baseline vs one observation):
  - required path missing (not explained by an ancestor change / empty array) → `removed` **breaking**
  - new path → `added` **info**
  - type changed → `type_changed` **breaking**; only `null` newly allowed → `nullable` **warning**
  - signature key missing → its severity; value changed → its severity
- `ignorePaths` (prefix match) excluded from inference and diff.
- Limits: depth 32, 5,000 paths per observation (truncation flagged in meta).
- **Dedup:** a drift event has a fingerprint (hash of sorted changes). No new event is created
  while an open or dismissed event with the same fingerprint exists.
- **Accept:** baseline ← observed (all observed paths required; previously optional paths
  kept optional; removed paths dropped; signature replaced).

## 6. Probes

- **HTTP:** method, URL, headers, secret headers, body, expected statuses (default 200–299), max
  latency, redirect policy, JSONPath assertions, JSON Schema. Non-JSON bodies are allowed
  (drift disabled for them).
- **LLM:** `openai` (POST `{baseUrl}/chat/completions`, `Authorization: Bearer`) or `anthropic`
  (POST `{baseUrl}/v1/messages`, `x-api-key`, `anthropic-version`). Extracts output text and
  reported `model`; assertions on text; optional JSON-output schema. Signature: `model` (warning).
- **MCP (Streamable HTTP):** `protocol=auto` tries modern `server/discover` (2026-07-28:
  stateless, `MCP-Protocol-Version` + `Mcp-Method` headers, `_meta` protocol version); on
  failure falls back to legacy `initialize` → `notifications/initialized` → `tools/list`
  with `Mcp-Session-Id`. JSON and SSE response bodies are both parsed. Optional `tools/call`
  (fails on JSON-RPC error or `isError: true`). Observed doc: `{ tools: { <name>: { inputSchema } } }`.
  Signature: protocol generation/version (warning), per-tool required params (breaking), per-tool schema hash (info).

## 7. Authentication & authorization

- First-run setup creates the only initial admin (`POST /auth/setup` works only while zero users exist).
- Login: argon2id verify; generic error message; per-IP rate limit (10/min); per-account lockout
  (10 consecutive failures → 15 minutes).
- Session cookie `tripline_session`: httpOnly, SameSite=Lax, Secure when `COOKIE_SECURE=true`
  (default in production), TTL `SESSION_TTL_HOURS` (sliding `last_seen_at`).
- **CSRF:** every state-changing request authenticated by cookie must carry header
  `X-Tripline-CSRF: 1` (a custom header cross-site forms cannot send, and CORS is not enabled),
  and if an `Origin` header is present it must match `APP_URL`.
- Roles: `viewer` (read) < `editor` (monitors, drift decisions, run) < `admin` (users, channels, audit).
- API tokens: `tl_…` bearer tokens, SHA-256 stored, **read-only** (GET only), inherit owner's role for reads.
- Admin password reset sets a temporary password and `mustChangePassword`.

## 8. Error handling

All errors map to `{ "error": { "code", "message", "request_id", "details"? } }` with the right
status. Known codes: `VALIDATION_ERROR` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403,
`CSRF_REJECTED` 403, `NOT_FOUND` 404, `CONFLICT` 409, `RATE_LIMITED` 429, `ACCOUNT_LOCKED` 423,
`SETUP_ALREADY_DONE` 409, `INTERNAL` 500 (message generic; details only in logs).

## 9. Logging & monitoring

- pino structured JSON logs; request id per request (`x-request-id` honored if sane, echoed back).
- Redaction: `authorization`, `cookie`, `set-cookie`, `x-api-key`, password fields, secret headers.
- Job logs: each check logs monitor id, kind, ok, duration, error code — never response bodies or secrets.
- `GET /healthz` (liveness) and `GET /readyz` (DB round-trip) for orchestrators.

## 10. Configuration & secrets

Environment variables only (see `.env.example`, documented in DEVELOPER_GUIDE.md).
`ENCRYPTION_KEY` (32 bytes, base64) encrypts monitor secrets and channel URLs/secrets. Losing
it makes stored secrets unrecoverable (documented). **Rotation:** set the new key as `ENCRYPTION_KEY` and the old one(s)
in `ENCRYPTION_KEY_PREVIOUS`; decryption tries each key (GCM authentication identifies the right one) and
startup / `npm run rotate-key` re-encrypts everything with the current key (`services/keys.ts`).

## 11. Caching

None needed at MVP scale. The dashboard summary is a handful of indexed aggregate queries.
TanStack Query caches on the client with polling (15 s) on live views.

## 12. Deployment & scalability

- One container / one Node process + PostgreSQL. Static frontend served by the backend.
- Horizontal scale: multiple instances against one PostgreSQL are safe for scheduling
  (row claims) and notifications (outbox claims). Not load-tested.
- Expected capacity (estimate, not measured): hundreds of monitors at ≥30 s intervals per instance.

## 13. Testing strategy

| Layer       | Tool                                                                                                                                              | Scope                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Vitest                                                                                                                                            | drift engine, JSONPath, assertions, crypto, SSRF classification, MCP SSE parsing, config                                     |
| Integration | Vitest + Fastify `inject` + PGlite in-memory + **real local HTTP servers** (generic JSON API, OpenAI-format, Anthropic-format, MCP modern+legacy) | every route, auth/roles/CSRF, runner end-to-end, incidents, drift lifecycle, notifications to a local webhook receiver, gate |
| E2E         | Playwright (Chromium) against the built app                                                                                                       | setup, login, create monitor, run, drift accept, channels, tokens                                                            |
| Contract    | test asserts committed `api/openapi.yaml` equals the generated spec                                                                               | docs ↔ code sync                                                                                                             |
