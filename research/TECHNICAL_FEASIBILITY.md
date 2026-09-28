# Technical Feasibility

## 1. Environment constraints (observed 2026-09-28)

| Tool                                                 | Available                    | Consequence                                                                        |
| ---------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| Node.js 24.14 / npm 11.19                            | Yes                          | TypeScript full stack is viable                                                    |
| Python 3.14                                          | Yes                          | Not needed                                                                         |
| Docker                                               | **No**                       | Dockerfile/compose can be written but **cannot be built or tested here**           |
| PostgreSQL server                                    | **No**                       | Need an embedded option for dev/tests                                              |
| Playwright browsers                                  | Yes (cached chromium builds) | Browser E2E feasible                                                               |
| Third-party credentials (OpenAI, Anthropic, Stripe…) | **No**                       | Real-provider probes cannot be exercised; use local protocol-faithful test servers |

## 2. Core capabilities and feasibility

| Capability                       | Approach                                                                                                                                                                                                                                                                                   | Risk                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Scheduled HTTP probes            | Node `fetch` (undici) with timeouts via `AbortSignal.timeout`; in-process scheduler claiming due monitors with `UPDATE … FOR UPDATE SKIP LOCKED`                                                                                                                                           | Low                                                                                                                                  |
| JSON structural baseline + drift | Pure function: flatten JSON into `path → type set`; merge N samples; diff with rules                                                                                                                                                                                                       | Low; well unit-testable                                                                                                              |
| JSON Schema assertions           | Ajv (mature, standard)                                                                                                                                                                                                                                                                     | Low                                                                                                                                  |
| JSONPath assertions              | Small subset (`$.a.b[0].c`) implemented in-house; avoids a dependency and `eval`-style engines                                                                                                                                                                                             | Low; documented subset                                                                                                               |
| LLM probes                       | OpenAI-compatible `/chat/completions` and Anthropic `/v1/messages` request templates, extract text + reported model                                                                                                                                                                        | Medium: provider formats change (that's the point); cannot test against real providers here                                          |
| MCP probes                       | Streamable HTTP. Modern (2026-07-28): stateless, `server/discover`, `MCP-Protocol-Version` + `Mcp-Method` headers, `_meta` protocol version. Legacy (2025-06-18/2025-11-25): `initialize` → `notifications/initialized` → `tools/list` with `Mcp-Session-Id`. Responses may be JSON or SSE | Medium: two protocol generations; verified against spec via Context7 docs; tested against a local reference server implementing both |
| Persistence                      | PostgreSQL via Drizzle ORM. Production: `pg` driver + `DATABASE_URL`. Dev/test without a server: **PGlite** (PostgreSQL compiled to WASM, same SQL dialect, same migrations)                                                                                                               | Medium: PGlite is single-connection; fine for single-node self-hosting, documented                                                   |
| Auth                             | Server-side sessions (random 256-bit token, SHA-256 hashed in DB), argon2id password hashing via `@node-rs/argon2` (prebuilt binaries, no compiler needed on Windows)                                                                                                                      | Low                                                                                                                                  |
| Secret storage                   | AES-256-GCM via `node:crypto` with key from env                                                                                                                                                                                                                                            | Low (standard primitive, standard library)                                                                                           |
| SSRF controls                    | Resolve target host, reject private/loopback/link-local unless `ALLOW_PRIVATE_TARGETS=true`; pin resolved IP through undici `Agent` `connect.lookup`                                                                                                                                       | Medium; tested                                                                                                                       |
| Frontend                         | React + Vite + TypeScript, served by the backend in production                                                                                                                                                                                                                             | Low                                                                                                                                  |

## 3. Things that cannot be verified in this environment

1. Real OpenAI / Anthropic / third-party API behavior (no credentials). **Workaround:** local
   test servers reproduce the documented request/response formats; users verify with their own
   keys. Clearly marked in PROJECT_STATUS.md.
2. Docker image build and docker-compose with real PostgreSQL. **Workaround:** files provided
   and reviewed; CI workflow builds the image on GitHub-hosted runners (untested until pushed).
3. Real PostgreSQL server. **Workaround:** identical migrations run on PGlite; the `pg` driver
   path is exercised in CI via a PostgreSQL service container (untested until pushed).

## 4. Verdict

Feasible. The core differentiators (drift engine, MCP dual-generation probe, gate API) are pure
software with no external dependency and can be fully tested locally.
