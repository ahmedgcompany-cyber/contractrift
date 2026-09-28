# AI Development Context

Written for AI coding assistants (Claude Code, Gemini, Copilot, Codex…) continuing this project.
Read this first, then [CLAUDE_CODE_GUIDE.md](CLAUDE_CODE_GUIDE.md) for workflows and
[PROJECT_STATUS.md](PROJECT_STATUS.md) for what is and isn't done.

## Product

Tripline is a self-hosted web app that monitors a team's external dependencies — HTTP JSON APIs,
LLM APIs, MCP servers. It runs scheduled probes, opens incidents on repeated failures, and —
its core differentiator — learns the **structure** of normal responses and reports **drift**
(fields removed/re-typed/newly null/added; LLM reported model changes; MCP tool/required-param
changes) with severities, plus an accept/dismiss workflow and a CI gate.

## Problem

Third-party APIs change silently; teams discover it from customers. Existing continuous drift
monitors are SaaS and need production credentials. See `research/PROBLEM_RESEARCH.md`.

## Architecture

Single Node.js process: Fastify HTTP API + static React SPA + in-process background jobs
(scheduler, notification outbox, retention). PostgreSQL via Drizzle; embedded PGlite when
`DATABASE_URL` is unset. Detailed: [ARCHITECTURE.md](ARCHITECTURE.md).

Check flow: `jobs/jobs.ts` claims due monitors (`FOR UPDATE SKIP LOCKED`) → `services/runner.ts#runMonitor`
decrypts secrets → `probes/index.ts#runProbe` → `ProbeOutcome` → `runner.record()` in ONE
transaction: insert check_result, availability/incident logic, baseline learning or drift diff,
outbox rows → `services/notifications.ts#processOutbox` delivers later.

## Technology (exact)

Node 24 (≥22.12) · TypeScript 6.0 strict (ESM, NodeNext) · Fastify 5 · TypeBox 1.x
(`typebox` package) via `@fastify/type-provider-typebox` 6 · Drizzle ORM 0.45 / drizzle-kit 0.31 ·
`pg` 8 · `@electric-sql/pglite` 0.5 · Ajv 8 · `@node-rs/argon2` 2 · undici 8 · React 19 · React
Router 8 · TanStack Query 5 · Vite 8 · Vitest 5 · Playwright 1.63 · ESLint 10 + typescript-eslint 8
· Prettier 3. npm workspaces: `backend`, `frontend`.

## Folder structure

See DEVELOPER_GUIDE.md "Repository layout". Key: `backend/src/{drift,probes,services,routes,plugins,jobs,lib,db}`,
`frontend/src/{pages,components}`, `database/migrations`, `api/openapi.yaml`, `tests/e2e`,
`backend/test/{unit,integration,support}`.

## Important files

| File                                          | Why it matters                                                                                                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/drift/shape.ts`, `drift/diff.ts` | Core IP: shape inference, diff rules, severity, fingerprint, accept. Pure; heavily unit-tested.                                                                                   |
| `backend/src/probes/mcp.ts`                   | Dual-generation MCP client (modern `server/discover` with `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` headers and `_meta`; legacy initialize + `Mcp-Session-Id`), SSE parsing. |
| `backend/src/probes/llm.ts`                   | Request building / output extraction for OpenAI and Anthropic formats.                                                                                                            |
| `backend/src/lib/http-client.ts`              | ALL outbound HTTP must go through `outboundRequest` (SSRF guard, timeouts, size cap).                                                                                             |
| `backend/src/services/runner.ts`              | Transactional recording: incidents + drift + outbox.                                                                                                                              |
| `backend/src/plugins/auth.ts`                 | Session/token resolution, CSRF, role gate, password-change gate.                                                                                                                  |
| `backend/src/routes/schemas.ts`               | Response schemas = serialization whitelist + OpenAPI.                                                                                                                             |
| `backend/src/db/schema.ts`                    | Single source of truth for the database.                                                                                                                                          |
| `backend/test/support/upstreams.ts`           | Local protocol-faithful stand-ins for OpenAI/Anthropic/MCP/JSON/webhooks (+ `/__control`).                                                                                        |
| `frontend/src/pages/MonitorForm.tsx`          | Form ↔ API config mapping for all kinds, write-only secrets.                                                                                                                      |

## Database

11 tables: users, sessions, api_tokens, monitors, baselines, check_results, incidents,
drift_events, notification_channels, notification_deliveries, audit_log. See DATABASE.md.

## API

REST under `/api/v1`, documented in API_DOCUMENTATION.md and `api/openapi.yaml` (generated).
Auth: session cookie + `X-Tripline-CSRF: 1` for writes, or read-only bearer tokens.

## Configuration

Env vars in DEVELOPER_GUIDE.md. Only `ENCRYPTION_KEY` is required.

## Development

```bash
npm ci
cp .env.example .env && npm run gen-key   # put key in .env
npm run dev          # API :3000 (watch)
npm run dev:web      # UI :5173 (set APP_URL=http://localhost:5173 for CSRF origin)
npm run upstreams -w backend              # fake upstreams :4010 (needs ALLOW_PRIVATE_TARGETS=true)
```

## Testing

```bash
npm run typecheck && npm run lint
npm test                                  # 140 Vitest tests (unit + integration, PGlite in-memory)
npm run test:live -w backend              # opt-in, real external services (see test/live/live.test.ts)
npm run build && npm run test:e2e         # 11 Playwright tests (PW_CHANNEL=chrome to use installed Chrome)
TEST_DATABASE_URL=postgres://… npm test   # against real PostgreSQL (DROPS schemas!)
```

## Deployment

Docker/compose files and CI exist but were never executed in the authoring environment. See DEPLOYMENT.md.

## Known issues

Canonical list: PROJECT_STATUS.md. Highlights: OpenAI/Anthropic cloud APIs never called (no keys); drift events/incidents/audit never pruned; in-memory rate limiting; static files indexed at startup (restart after rebuild).

## Development rules — do NOT break

1. **Never return or log secret values.** Secrets live only in `secretsEnc`/`configEnc`. New
   response fields must be added to `routes/schemas.ts` deliberately.
2. **All outbound HTTP via `outboundRequest`** (SSRF protection). Never call `fetch` for user URLs.
3. **Don't edit applied migrations**; generate new ones with `npm run db:generate`.
4. **Keep `api/openapi.yaml` in sync** (`npm run openapi`); a test enforces it.
5. **Routes → services → db.** No Fastify types in services; no DB in probes/drift.
6. **Recording a check stays one transaction** (incident uniqueness and drift dedup depend on it).
7. **Probes set `observed` only for "normal" responses** (expected status, parseable JSON) —
   otherwise error bodies pollute baselines.
8. **CSRF header + origin check** must remain for cookie-authenticated writes; API tokens stay read-only.
9. **Drizzle `sql` templates inside `.select({ … })`** render column refs unqualified — qualify
   explicitly (`"monitors"."id"`) in correlated subqueries (a real bug was fixed here).
10. Don't claim features in docs that aren't implemented; update PROJECT_STATUS.md and CHANGELOG.md with changes.
11. On Windows, unsigned native executables (e.g. Biome, oxlint) are blocked by Application
    Control on the original machine — prefer pure-JS tooling.

## Future work

See ROADMAP.md. Highest value next: run the live suite with OpenAI/Anthropic keys; drift-event retention;
shared rate-limit store; email notifications.
