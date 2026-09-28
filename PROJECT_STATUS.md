# Project Status

Last updated: 2026-09-28 · Version 0.1.0 · Location: `C:\Users\AHMED\projects\tripline` (git, branch `main`, not pushed to any remote)

## PROJECT OVERVIEW

Tripline is a self-hosted monitor for external dependencies (HTTP JSON APIs, LLM APIs, MCP
servers) that detects outages **and silent structural drift**, with incidents, notifications,
a CI gate, users/roles and an audit log. Selected after documented research
(`research/PROBLEM_RESEARCH.md`, decision matrix score 35/40 vs. 21–27 for alternatives).

**Status: functional MVP.** All MVP features in PRODUCT_SPEC.md §7 are implemented and tested
locally. It has **not** been verified against real third-party providers, in Docker, against a
PostgreSQL server, or in CI.

## COMPLETED

- Research docs (problem, competitors, pain points, feasibility, sources) and product spec, architecture.
- Probes: HTTP; LLM (OpenAI-compatible, Anthropic formats); MCP Streamable HTTP (2026-07-28 stateless + initialize-based; JSON + SSE).
- Drift engine: shape inference, multi-sample baseline, breaking/warning/info diff, signatures, ignore paths, fingerprint dedup, accept/dismiss, reset.
- Assertions: status, latency, JSONPath subset, JSON Schema, LLM text checks, MCP expected tools + tool call; ReDoS guard.
- Incidents (threshold, one-open-per-monitor DB constraint), notification outbox (webhook+HMAC, Slack, retries/backoff, delivery log, test send).
- Scheduler with `SKIP LOCKED` claims, graceful shutdown, retention pruning.
- Auth: first-run setup, login/logout, argon2id, sessions (hashed), lockout, rate limits, CSRF header + origin check, roles, forced password change, admin reset, CLI recovery, read-only API tokens, audit log.
- Security: SSRF guard (connect-time DNS check), AES-256-GCM secrets, write-only secrets, response whitelisting, log redaction, CSP/helmet.
- REST API (29 paths) + generated OpenAPI 3.1 with a sync test.
- React UI: setup/login/password change, dashboard, monitors list/filter, monitor detail (chart, history, baseline, drift, incidents), create/edit form with dry-run, drift inbox, incidents, channels, users, tokens, audit, account; loading/empty/error states; confirmations; toasts; light/dark; responsive (375 px verified).
- CI gate script (exit 0/1/2), demo seed, `.env.example`, Dockerfile, docker-compose, GitHub Actions workflow.
- Full documentation set (see DOCUMENTATION STATUS).

## PARTIALLY COMPLETED

| Item                      | State                                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL server support | Code path (`pg` driver) implemented; test harness supports `TEST_DATABASE_URL`; **never executed** (no PostgreSQL available). CI job configured.               |
| Docker                    | Dockerfile/compose written and reviewed; **never built**. CI job configured.                                                                                   |
| CI/CD                     | Workflow written; **never run** (repo not pushed). No deployment workflow (no target exists).                                                                  |
| Multi-instance scheduling | Designed to be safe (`SKIP LOCKED`, row locks); verified only with concurrent claims inside one PGlite process. Not load-tested. Rate limiting is per-process. |
| Accessibility             | Labels/roles/focus styles/keyboard-usable controls; no formal audit (screen reader, contrast measurement).                                                     |

## NOT IMPLEMENTED

Email notifications; per-monitor channel routing; maintenance windows; OpenAPI/GraphQL/gRPC-based
checks; LLM judge/similarity scoring and token cost tracking; MCP resources/prompts; stdio MCP;
SSO/MFA; email-based password reset / email verification (by design: admin-provisioned accounts);
`ENCRYPTION_KEY` rotation; secret URL query parameters; pagination of `GET /monitors`; retention
for drift events/incidents/audit log; Prometheus metrics; status pages; multi-region agents;
Kubernetes manifests. (See ROADMAP.md.)

## KNOWN BUGS

None open. Bugs found and fixed during development are listed in CHANGELOG.md.

## KNOWN LIMITATIONS

| Problem                                                | Cause                                           | Current status                                                       | Workaround                                         | Recommended solution                                          |
| ------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| Real OpenAI/Anthropic/MCP providers never called       | No credentials in the build environment         | Probes verified against local servers reproducing documented formats | Test with your own keys via **Test configuration** | Add opt-in live tests (env-gated) and run them before release |
| Docker & PostgreSQL untested                           | Neither available on the build machine          | Files + CI jobs exist                                                | Run `docker compose up` / CI                       | Push repo, let CI run, fix findings                           |
| Static UI files indexed at startup                     | `@fastify/static` with `wildcard: false`        | Documented                                                           | Restart after rebuilding the UI                    | Acceptable for production (immutable builds)                  |
| Credentials in URLs stored in clear                    | URL is non-secret config                        | Documented in USER_GUIDE/SECURITY                                    | Use secret headers                                 | Secret query params (ROADMAP)                                 |
| No key rotation                                        | Not implemented                                 | Changing key → `CONFIG` errors                                       | Keep key stable; re-enter secrets if lost          | Dual-key rotation                                             |
| `GET /monitors` unpaginated                            | MVP scope                                       | 31 ms / 250 KB at 200 monitors (measured)                            | —                                                  | Pagination                                                    |
| Drift is structural only                               | Design                                          | Value changes not detected except signatures                         | JSONPath `equals` assertions                       | Optional value tracking                                       |
| Open drift events not auto-closed after a later accept | Design simplicity                               | Documented                                                           | Dismiss older events                               | Auto-supersede (ROADMAP)                                      |
| PGlite single-connection                               | PGlite design                                   | Fine for single node                                                 | Use PostgreSQL                                     | —                                                             |
| Biome unusable on this machine                         | Windows Application Control blocks unsigned exe | Switched to ESLint/Prettier                                          | —                                                  | —                                                             |
| Product name "Tripline" not cleared                    | Similar names exist on GitHub                   | Working name                                                         | —                                                  | Trademark/name search (user action)                           |

## SECURITY NOTES

See SECURITY.md. Review performed for SQLi, XSS, CSRF, SSRF, command injection, path traversal,
uploads (none), authn/authz, secrets, logging, CORS, headers, sessions. `npm audit`: 0 production
vulnerabilities; 4 moderate dev-only (drizzle-kit's bundled esbuild; accepted, documented).
Residual risks: SSRF-by-design for editors, heuristic ReDoS guard, no MFA, in-memory rate limits.

## TEST RESULTS (all executed 2026-09-28 on Windows 11, Node 24.14.1)

| Suite                                                                                                                  | Result                                                   |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Typecheck (backend + frontend, TS 6.0.3 strict)                                                                        | pass                                                     |
| ESLint + Prettier                                                                                                      | pass (0 errors)                                          |
| Vitest unit + integration (PGlite, real local upstream servers)                                                        | **134 passed / 134** (7 files)                           |
| Playwright E2E (built app, Chrome channel; desktop + Pixel 7 mobile)                                                   | **10 passed / 10** (run 3× consecutively without flakes) |
| Clean-clone packaging check (`git clone` → `npm ci` → typecheck → lint → test → build → E2E → `npm start` → `/readyz`) | pass                                                     |
| Manual browser walkthrough (setup, create/test monitor, runs, drift accept, light/dark, 375 px)                        | pass (found and fixed 4 UI/serving bugs)                 |
| Performance spot check (200 monitors × 30 results)                                                                     | `/monitors` median 31 ms, `/summary` 5 ms, `/drift` 2 ms |
| PostgreSQL server, Docker build, CI                                                                                    | **not run**                                              |

## DOCUMENTATION STATUS

Complete and checked against the implementation: README, INSTALLATION, USER_GUIDE,
DEVELOPER_GUIDE, ARCHITECTURE, API_DOCUMENTATION (+ generated `api/openapi.yaml`), DATABASE,
DEPLOYMENT, TROUBLESHOOTING, SECURITY, ROADMAP, AI_DEVELOPMENT_CONTEXT, CLAUDE_CODE_GUIDE,
CLAUDE.md/AGENTS.md, MARKETING_CONTEXT, PRODUCT_SPEC, CHANGELOG, research/*. No screenshots are
included in the docs.

## DEPLOYMENT STATUS

Not deployed anywhere. Runs locally via `npm start`. No cloud provider configured.

## EXTERNAL DEPENDENCIES

Runtime: Node.js; PostgreSQL (optional). Monitored services are whatever users configure.
Notification targets: any HTTPS webhook / Slack incoming webhook. No Tripline-operated services.

## REQUIRES USER ACTION

1. **License decision.** MIT was chosen provisionally (maximizes adoption). If you intend a
   commercial open-core product, consider AGPL-3.0 or BSL before publishing. Update `LICENSE`,
   `package.json` and README.
2. **Name clearance** for "Tripline" (other projects use similar names).
3. **Security contact** for SECURITY.md.
4. **Push to GitHub** (create a remote) so CI runs PostgreSQL, Docker and Linux E2E jobs.
5. **Real-provider verification** with your own OpenAI/Anthropic keys and an MCP server.
6. Optional: choose a hosting target if you want a deployment workflow.

## RECOMMENDED NEXT STEPS

1. Push and get CI green (PostgreSQL + Docker + Linux E2E).
2. Verify LLM/MCP probes against real services; add env-gated live tests.
3. Implement key rotation and secret query parameters.
4. Paginate monitor list; add retention for drift/incidents/audit.
5. Early-user validation of the self-hosting assumption (PRODUCT_SPEC §12).

## FUTURE DEVELOPMENT

See ROADMAP.md: email/routing, OpenAPI/GraphQL expectations, LLM quality checks, Prometheus,
config-as-code, SSO/MFA, remote probe agents, hosted control plane.
