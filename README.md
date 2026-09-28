# Tripline

**Self-hosted monitoring for the external dependencies your application relies on — REST APIs,
LLM APIs and MCP tool servers.** Tripline sends real, authenticated probe requests on a schedule
and tells you not only when a dependency is **down**, but when it has **silently changed**: a
field disappeared, a type changed, the provider now reports a different model behind your
alias, or an MCP server dropped a tool or added a required parameter.

Your API keys stay on your infrastructure: secrets are encrypted at rest and never returned by
the API.

> Status: **v0.1.0 — functional MVP, not yet production-proven.** See
> [PROJECT_STATUS.md](PROJECT_STATUS.md) for exactly what is verified and what is not.

## Why

Upstream APIs change without you changing anything. Unit tests use frozen mocks, integration
tests run only on pull requests, uptime monitors only check the status code, and the SaaS
drift monitors that exist need your production credentials. Research and evidence:
[research/PROBLEM_RESEARCH.md](research/PROBLEM_RESEARCH.md).

## What it does (implemented)

- **Three probe kinds:** HTTP(S) JSON endpoints; LLM APIs in OpenAI-compatible (Chat Completions)
  or Anthropic (Messages) format; MCP servers over Streamable HTTP — both the 2026-07-28
  stateless protocol and older initialize-based servers, auto-detected.
- **Automatic structural baseline** learned from the first N successful responses; later
  responses are diffed and classified as **breaking** (field removed, type changed), **warning**
  (field became null, model changed) or **info** (field added).
- **Accept / dismiss workflow** for drift, ignored paths, baseline reset.
- **Assertions:** status codes, latency, JSONPath subset, JSON Schema, LLM output checks, MCP
  expected tools and a test tool call.
- **Incidents** after N consecutive failures; resolved on the next success.
- **Notifications:** HMAC-signed webhooks and Slack, with retries and a delivery log.
- **CI deploy gate:** `GET /api/v1/gate` + `scripts/tripline-gate.mjs` (exit code 0/1/2).
- **Users & roles** (viewer / editor / admin), read-only API tokens, audit log.
- **Security:** argon2id, server-side sessions, CSRF header, lockout, rate limits, SSRF guard,
  AES-256-GCM secrets, strict CSP. Details: [SECURITY.md](SECURITY.md).

## Quick start (local, no database server needed)

Requires Node.js 22.12+ (developed on 24).

```bash
npm ci
cp .env.example .env
npm run gen-key            # paste the output into ENCRYPTION_KEY in .env
npm run build
npm start                  # http://localhost:3000 → create the admin account
```

Without `DATABASE_URL`, Tripline stores data in an embedded PostgreSQL (PGlite) under
`./data/pglite`. For production use PostgreSQL — see [DEPLOYMENT.md](DEPLOYMENT.md).

Try it without any real credentials using the bundled test-substitute upstreams:

```bash
npm run upstreams -w backend   # fake JSON API, OpenAI/Anthropic formats, MCP servers on :4010
# in .env set ALLOW_PRIVATE_TARGETS=true, then:
npm run seed:demo -w backend -- --upstreams http://127.0.0.1:4010
```

## Documentation

| Document                                                                                                                                         | Purpose                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| [INSTALLATION.md](INSTALLATION.md)                                                                                                               | Install and first run                                 |
| [USER_GUIDE.md](USER_GUIDE.md)                                                                                                                   | Using the product                                     |
| [DEPLOYMENT.md](DEPLOYMENT.md)                                                                                                                   | Docker, PostgreSQL, reverse proxy, upgrades, rollback |
| [API_DOCUMENTATION.md](API_DOCUMENTATION.md) · [api/openapi.yaml](api/openapi.yaml)                                                              | HTTP API                                              |
| [ARCHITECTURE.md](ARCHITECTURE.md) · [DATABASE.md](DATABASE.md)                                                                                  | Design                                                |
| [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) · [CLAUDE_CODE_GUIDE.md](CLAUDE_CODE_GUIDE.md) · [AI_DEVELOPMENT_CONTEXT.md](AI_DEVELOPMENT_CONTEXT.md) | Working on the code                                   |
| [SECURITY.md](SECURITY.md) · [TROUBLESHOOTING.md](TROUBLESHOOTING.md)                                                                            | Operations                                            |
| [PRODUCT_SPEC.md](PRODUCT_SPEC.md) · [ROADMAP.md](ROADMAP.md) · [MARKETING_CONTEXT.md](MARKETING_CONTEXT.md)                                     | Product                                               |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) · [CHANGELOG.md](CHANGELOG.md)                                                                            | Status                                                |

## Tech

TypeScript · Node.js 24 · Fastify 5 · Drizzle ORM · PostgreSQL / PGlite · React 19 · Vite ·
TanStack Query · Vitest · Playwright.

## License

MIT — see [LICENSE](LICENSE). The license choice is provisional; see PROJECT_STATUS.md
("Requires user action").
