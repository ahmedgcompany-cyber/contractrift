# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer.

## 0.1.0 — 2026-09-28

First functional MVP.

### Added

- Research: problem discovery, decision matrix, competitor analysis, feasibility (`research/`).
- Monitors for HTTP JSON APIs, LLM APIs (OpenAI-compatible Chat Completions, Anthropic Messages) and MCP servers (Streamable HTTP; 2026-07-28 stateless and initialize-based, auto-detected; JSON and SSE responses).
- Structural baseline learning, drift diff with breaking/warning/info severity, tracked signatures (LLM reported model, MCP protocol/tool required params/schema hash), ignored paths, dedup by fingerprint, accept/dismiss, baseline reset.
- Assertions: status, latency, JSONPath subset, JSON Schema, LLM output checks, MCP expected tools and tool call.
- Incidents with consecutive-failure threshold; notification outbox (webhook with HMAC signature, Slack) with retries and delivery log.
- CI gate endpoint and dependency-free `scripts/tripline-gate.mjs`.
- Users with viewer/editor/admin roles, first-run setup, forced password change, admin reset, CLI recovery, account lockout, read-only API tokens, audit log.
- SSRF-guarded outbound client, AES-256-GCM secret storage, CSP and security headers, rate limits.
- PostgreSQL schema + migrations (Drizzle); embedded PGlite fallback; retention job.
- React UI: dashboard, monitors, monitor detail (latency chart, history, baseline, drift, incidents), monitor form with dry-run testing, drift inbox, incidents, notifications, users, tokens, audit log, account; light/dark; responsive.
- OpenAPI 3.1 document generated from route schemas.
- Tests: 134 unit/integration (Vitest), 10 E2E (Playwright). Dockerfile, docker-compose, GitHub Actions CI.

### Fixed (during development)

- CI gate counted drift events of the wrong row (unqualified column in a correlated subquery).
- Static assets returned 500 (`@fastify/static` v10 passes a reply to `setHeaders`); missing assets returned the SPA page instead of 404.
- Background jobs started before the HTTP port was bound.
- Gate script crashed on Windows at exit (pooled fetch socket); rewritten with `node:http` and no keep-alive.
- MCP tool schema hash depended on the order of `required`.
- Mobile layout overflowed horizontally; form inputs lacked programmatic labels.

### Known Issues

- Docker image, docker-compose and PostgreSQL-server mode not executed in the development environment; CI not yet run.
- No real third-party provider was called (no credentials); probes verified against local protocol-faithful substitutes.
- See PROJECT_STATUS.md for the complete list.
