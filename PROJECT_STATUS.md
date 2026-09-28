# Project Status

Last updated: 2026-09-28 · Version **0.2.0**
Repository: https://github.com/ahmedgcompany-cyber/tripline (private) · Local copies: `C:\Users\AHMED\projects\tripline`, `C:\Users\AHMED\OneDrive\Desktop\Project_2026\tripline`

## PROJECT OVERVIEW

Tripline is a self-hosted monitor for external dependencies (HTTP JSON APIs, LLM APIs, MCP
servers). It detects outages **and silent structural drift**, with incidents, notifications, a CI
gate, users/roles and an audit log. Chosen after documented research (`research/`).

**Status: functional, CI-verified MVP.** All MVP features plus key rotation, secret URL
parameters and pagination are implemented and tested — locally, in CI against PostgreSQL 17 and
as a running docker-compose stack, and against real public services. Not yet: load testing,
live tests against OpenAI/Anthropic cloud APIs, any production deployment.

## COMPLETED

- Research, product spec, architecture.
- Probes: HTTP; LLM (OpenAI-compatible, Anthropic); MCP Streamable HTTP (2026-07-28 stateless + initialize-based; JSON + SSE; tool calls).
- Drift engine (baseline, severities, signatures, ignore paths, dedup, accept/dismiss, reset).
- Assertions (status, latency, JSONPath, JSON Schema, LLM output, MCP tools), ReDoS guard.
- Incidents; notification outbox (signed webhooks, Slack, retries, delivery log, test send).
- Scheduler (`SKIP LOCKED`), graceful shutdown, retention.
- Auth: setup, login/logout, argon2id, hashed sessions, lockout, configurable auth rate limit, CSRF, roles, forced password change, admin reset, CLI recovery, read-only API tokens, audit log.
- Security: SSRF guard, AES-256-GCM secrets, **key rotation** (`ENCRYPTION_KEY_PREVIOUS`, auto re-encrypt, `rotate-key` CLI), **secret URL parameters**, response whitelisting, log redaction, CSP.
- API (29 paths, **paginated monitor list**) + generated OpenAPI with sync test.
- React UI incl. pager and secret URL parameter editor; light/dark; responsive.
- CI gate script, demo seed, Docker/compose, GitHub Actions (4 jobs, all green).
- Opt-in live test suite against real services.
- Full documentation set.

## PARTIALLY COMPLETED

| Item                      | State                                                                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real LLM providers        | OpenAI-compatible protocol verified against a real local server (LM Studio). **OpenAI and Anthropic cloud APIs not called** — no keys available. Tests exist and run when `LIVE_OPENAI_API_KEY` / `LIVE_ANTHROPIC_API_KEY` are set. |
| Multi-instance scheduling | Designed safe (`SKIP LOCKED`, row locks); concurrent claims tested against real PostgreSQL in CI; not load-tested. Rate limiting is per process.                                                                                    |
| Accessibility             | Labels, roles, focus styles, keyboard use; no formal audit.                                                                                                                                                                         |

## NOT IMPLEMENTED

Email notifications; per-monitor routing; maintenance windows; OpenAPI/GraphQL/gRPC checks; LLM
judge/similarity and cost tracking; MCP resources/prompts and stdio transport; SSO/MFA; email
password reset (admin-provisioned accounts by design); retention for drift events/incidents/audit
log; Prometheus metrics; status pages; multi-region agents; Kubernetes manifests; deployment workflow.

## KNOWN BUGS

None open. One E2E run out of 15 local runs failed once and could not be reproduced in 10
consecutive reruns afterwards (CI retries once); cause unknown.

## KNOWN LIMITATIONS

| Problem                                              | Cause                                                                                               | Current status                                                               | Workaround                                           | Recommended solution            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------- |
| OpenAI/Anthropic cloud not live-tested               | No API keys here                                                                                    | Live tests written, skipped without keys                                     | `LIVE_OPENAI_API_KEY=… npm run test:live -w backend` | Run once with your keys         |
| Static UI indexed at startup                         | `@fastify/static` `wildcard: false`                                                                 | Documented                                                                   | Restart after rebuilding UI                          | Fine for immutable deploys      |
| Drift is structural only                             | Design                                                                                              | Value changes need assertions                                                | JSONPath `equals`                                    | Optional value tracking         |
| Older open drift events not auto-closed after accept | Simplicity                                                                                          | Documented                                                                   | Dismiss                                              | Auto-supersede                  |
| In-memory rate limits                                | Per-process store                                                                                   | Documented                                                                   | Single instance or sticky LB                         | Shared store                    |
| PGlite single-connection                             | PGlite design                                                                                       | Fine for single node                                                         | PostgreSQL                                           | —                               |
| Local tooling quirks (this PC)                       | Windows Application Control blocks unsigned `.exe` (Biome); gstack browse v0.16 unstable on Windows | Project uses ESLint/Prettier; QA done with the built-in browser + Playwright | —                                                    | Upgrade gstack (1.91 available) |
| Name "Tripline" not cleared                          | Similar names exist                                                                                 | Working name                                                                 | —                                                    | Name search                     |

## SECURITY NOTES

See SECURITY.md. `npm audit`: 0 production vulnerabilities (also enforced in CI); 4 moderate
dev-only (drizzle-kit's bundled esbuild; accepted). Residual risks: SSRF-by-design for editors,
heuristic ReDoS guard, no MFA, in-memory rate limits.

## TEST RESULTS (2026-09-28)

| Suite                                                                                                                                                                       | Where                          | Result                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------- |
| Typecheck, ESLint, Prettier                                                                                                                                                 | local + CI                     | pass                                                                      |
| Unit + integration (PGlite)                                                                                                                                                 | local (Windows) + CI (Ubuntu)  | **140 / 140**                                                             |
| Same suite on **PostgreSQL 17**                                                                                                                                             | CI                             | **140 / 140**                                                             |
| Playwright E2E (desktop + mobile)                                                                                                                                           | local (Chrome) + CI (Chromium) | **11 / 11** (local: 14 of 15 runs clean, see Known bugs)                  |
| **docker-compose stack** (build, start, `/readyz` on pg, setup, real outbound check, restart + persistence, healthcheck)                                                    | CI                             | pass                                                                      |
| **Live, real services**: GitHub REST API; DeepWiki MCP (initialize-based, tool call); Hugging Face MCP (2026-07-28 stateless, tool call); LM Studio (OpenAI-compatible LLM) | local                          | **4 / 4 passed**; OpenAI + Anthropic skipped (no keys)                    |
| Manual UI QA (setup, monitor create/test/run, drift accept, pagination, themes, 375 px)                                                                                     | built-in browser               | pass                                                                      |
| Clean-clone packaging check                                                                                                                                                 | local                          | pass (v0.1.0)                                                             |
| Performance (200 monitors × 30 results)                                                                                                                                     | local                          | `/monitors` median 31 ms (unpaginated, pre-0.2; now ≤ 200 items per page) |

CI runs: https://github.com/ahmedgcompany-cyber/tripline/actions

## DOCUMENTATION STATUS

Complete and updated for 0.2.0: README, INSTALLATION, USER_GUIDE, DEVELOPER_GUIDE, ARCHITECTURE,
API_DOCUMENTATION + `api/openapi.yaml`, DATABASE, DEPLOYMENT (incl. key rotation), TROUBLESHOOTING,
SECURITY, ROADMAP, AI_DEVELOPMENT_CONTEXT, CLAUDE_CODE_GUIDE, CLAUDE.md/AGENTS.md, MARKETING_CONTEXT,
PRODUCT_SPEC, CHANGELOG, research/*.

## DEPLOYMENT STATUS

No hosted deployment. Runs via `npm start` or `docker compose up -d --build` (verified in CI).

## EXTERNAL DEPENDENCIES

Node.js; PostgreSQL (optional). Monitored services and notification targets are user-configured.

## REQUIRES USER ACTION

1. **License decision** — MIT is provisional (AGPL-3.0/BSL if you want to protect a commercial offering).
2. **Name clearance** for "Tripline".
3. **Security contact** in SECURITY.md.
4. **Repository visibility** — created **private**; make it public in GitHub settings if intended.
5. Optional: run `npm run test:live -w backend` with `LIVE_OPENAI_API_KEY` / `LIVE_ANTHROPIC_API_KEY`.
6. Optional: choose a hosting target for a deployment workflow.

## RECOMMENDED NEXT STEPS

1. Live-test OpenAI/Anthropic with your keys.
2. Retention for drift events/incidents/audit log; auto-supersede drift events.
3. Shared rate-limit store; load test multi-instance scheduling.
4. Email notifications + per-monitor routing.
5. Early-user validation of the self-hosting value proposition.

## FUTURE DEVELOPMENT

See ROADMAP.md.
