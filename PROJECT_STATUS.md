# Project Status

Last updated: 2026-09-28 · Version **0.3.1** (renamed from "Tripline" in this release)

- Repository (public): https://github.com/ahmedgcompany-cyber/contractrift
- Website: https://ahmedgcompany-cyber.github.io/contractrift/
- Docker image: `ghcr.io/ahmedgcompany-cyber/contractrift:0.3.0` (multi-arch, publicly pullable)
- Local copies: `C:\Users\AHMED\projects\tripline` (working copy) · `C:\Users\AHMED\OneDrive\Desktop\Project_2026\contractrift`

## PROJECT OVERVIEW

ContractRift is a self-hosted monitor for external dependencies (HTTP JSON APIs, LLM APIs, MCP servers). It detects
outages **and silent structural drift**, with incidents, notifications, a CI gate, users/roles and an audit log.
Selected after documented research (`research/`).

**Status: functional, CI-verified, publicly released MVP with a live demo (https://136-119-147-140.sslip.io).** Not yet:
live tests against OpenAI/Anthropic cloud APIs (needs keys), load testing.

## COMPLETED

- Research, product spec, architecture; rename to ContractRift after availability checks (GitHub, npm, web, `.com`/`.dev`).
- Probes: HTTP; LLM (OpenAI-compatible, Anthropic); MCP Streamable HTTP (2026-07-28 stateless + initialize-based, JSON + SSE, tool calls).
- Drift engine, assertions, incidents, notification outbox, scheduler, retention.
- Auth & security: argon2id, hashed sessions, lockout, configurable auth rate limit, CSRF, roles, API tokens, audit log,
  SSRF guard, AES-256-GCM secrets with key rotation, secret URL parameters, `SETUP_TOKEN`, `DEMO_MODE`.
- Paginated API (29 paths) with generated OpenAPI; React UI (light/dark, responsive).
- Packaging: Dockerfile, docker-compose, Render blueprint, GHCR release workflow (v0.3.0 published), GitHub Pages website.
- CI: lint/typecheck/tests (PGlite), tests on PostgreSQL 17, Playwright E2E, docker-compose stack run.
- Licensing: AGPL-3.0 + commercial (COMMERCIAL_LICENSE.md, CONTRIBUTING.md contribution terms).
- Security reporting: GitHub private vulnerability reporting enabled.
- Launch: README with screenshots, website, launch kit with ready-to-post texts (`launch/`).

## PARTIALLY COMPLETED

| Item                      | State                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Real LLM providers        | OpenAI-compatible protocol verified against a real local server (LM Studio). OpenAI and Anthropic cloud: tests written, **not run** (no keys). |
| Multi-instance scheduling | Designed safe; concurrent claims tested on PostgreSQL in CI; not load-tested; rate limits are per process.                                     |
| Accessibility             | Labels, roles, focus, keyboard; no formal audit.                                                                                               |
| Public exposure           | All assets ready and repo public; the actual posts must come from the owner's accounts.                                                        |

## NOT IMPLEMENTED

Email notifications; per-monitor routing; maintenance windows; OpenAPI/GraphQL/gRPC checks; LLM judge/cost tracking;
MCP resources/prompts and stdio; SSO/MFA; email password reset (by design); retention for drift events/incidents/audit;
Prometheus metrics; status pages; multi-region agents; Kubernetes manifests; deployment workflow (hosting not yet created).

## KNOWN BUGS

None open. One local E2E run out of 15 (during 0.2 work) failed once and was not reproducible in 10 reruns; CI retries once.

## KNOWN LIMITATIONS

| Problem                                                | Cause                                                                                                                           | Status                               | Workaround                           | Recommended solution                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------ | -------------------------------------------- |
| OpenAI/Anthropic not live-tested                       | No keys                                                                                                                         | Tests skip without keys              | See launch/YOUR_NEXT_STEPS.md step 2 | Run once                                     |
| Demo runs on a 1 GB free VM with an IP-based host name | Free tier                                                                                                                       | Live, monitored by a $5 budget alert | —                                    | Buy a domain; larger host when traffic grows |
| Static UI indexed at startup                           | `@fastify/static` `wildcard: false`                                                                                             | Documented                           | Restart after rebuild                | Fine for immutable deploys                   |
| Drift is structural only                               | Design                                                                                                                          | Documented                           | JSONPath assertions                  | Optional value tracking                      |
| In-memory rate limits                                  | Per-process                                                                                                                     | Documented                           | Single instance                      | Shared store                                 |
| Name not trademark-registered                          | Not a legal clearance                                                                                                           | Availability checked only            | —                                    | Trademark search + domain before selling     |
| Local-machine quirks                                   | Windows Application Control blocks unsigned `.exe`; `~/.claude/settings.json` has a UTF-8 BOM so gstack could not add its hooks | Documented                           | ESLint/Prettier used                 | Remove the BOM if you want gstack's hooks    |

## SECURITY NOTES

See SECURITY.md. `npm audit`: 0 production vulnerabilities (enforced in CI); 4 moderate dev-only (drizzle-kit's bundled
esbuild; accepted). Commit history uses the GitHub no-reply address (personal email removed before publishing).

## TEST RESULTS (2026-09-28)

| Suite                                                                                                                        | Where                         | Result                                               |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------- |
| Typecheck, ESLint, Prettier                                                                                                  | local + CI                    | pass                                                 |
| Unit + integration (PGlite)                                                                                                  | local (Windows) + CI (Ubuntu) | **147 / 147**                                        |
| Same suite on PostgreSQL 17                                                                                                  | CI                            | pass                                                 |
| Playwright E2E (desktop + mobile)                                                                                            | local (Chrome) + CI           | **11 / 11**                                          |
| docker-compose stack (build, start, readiness on PostgreSQL, setup, real outbound check, restart + persistence, healthcheck) | CI                            | pass                                                 |
| Live real services: GitHub API, DeepWiki MCP, Hugging Face MCP (tool calls on both protocol generations), LM Studio LLM      | local                         | 4 / 4 (OpenAI + Anthropic skipped)                   |
| Release: GHCR image + GitHub Release; website                                                                                | GitHub                        | published; image pulls anonymously; site returns 200 |

CI: https://github.com/ahmedgcompany-cyber/contractrift/actions

## DOCUMENTATION STATUS

Complete for 0.3.0: README, INSTALLATION, USER_GUIDE, DEVELOPER_GUIDE, ARCHITECTURE, API_DOCUMENTATION + OpenAPI,
DATABASE, DEPLOYMENT (Render, Docker, key rotation), TROUBLESHOOTING, SECURITY, ROADMAP, AI_DEVELOPMENT_CONTEXT,
CLAUDE_CODE_GUIDE, CLAUDE.md/AGENTS.md, CONTRIBUTING, COMMERCIAL_LICENSE, MARKETING_CONTEXT, PRODUCT_SPEC, CHANGELOG,
research/_, launch/_.

## DEPLOYMENT STATUS

**Live public demo:** https://136-119-147-140.sslip.io on a Google Cloud e2-micro (Always Free) VM, Docker + Caddy HTTPS, v0.3.1, DEMO_MODE on, $5 budget alert. Verified: HTTPS with HSTS, HTTP to HTTPS redirect, demo checks against the GitHub API, Hugging Face MCP and DeepWiki MCP succeeding from the server with 0 errors. Also deployable via Render blueprint or docker-compose.

## EXTERNAL DEPENDENCIES

Node.js; PostgreSQL (optional). Monitored services and notification targets are user-configured.

## REQUIRES USER ACTION

Step-by-step: [launch/YOUR_NEXT_STEPS.md](launch/YOUR_NEXT_STEPS.md).

1. Create your admin account on the live demo with the setup token (YOUR_NEXT_STEPS.md step 1).
2. OpenAI / Anthropic live test (your API keys in `.env`).
3. Upload the social preview image (GitHub UI only).
4. Publish the launch posts from your own accounts.
5. Before selling: trademark search, register the domain, lawyer-reviewed commercial license contract.

Decided 2026-09-28: name ContractRift · AGPL-3.0 + commercial · GitHub private vulnerability reporting · public repo · Render.

## RECOMMENDED NEXT STEPS

1. Launch (Show HN first).
2. Live-test OpenAI/Anthropic.
3. Retention for drift events/incidents/audit; auto-supersede drift events.
4. Email notifications + per-monitor routing.
5. Talk to early users; validate the self-hosting value proposition before pricing.

## FUTURE DEVELOPMENT

See ROADMAP.md.
