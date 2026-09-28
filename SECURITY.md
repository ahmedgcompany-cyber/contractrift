# Security

## Reporting

Please report vulnerabilities **privately** through GitHub:
[Security → Report a vulnerability](https://github.com/ahmedgcompany-cyber/contractrift/security/advisories/new).
Do not open public issues for security problems. We aim to acknowledge reports within 7 days.

## Threat model (summary)

ContractRift holds **credentials for third-party services** (API keys, bearer tokens, webhook URLs)
and **makes outbound requests to user-configured URLs**. The main risks are therefore credential
disclosure and server-side request forgery, followed by the usual web-application risks.

## Controls

| Area             | Control                                                                                                                                                                                                                                                                          | Where                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| First-run setup  | Optional `SETUP_TOKEN` required to create the first admin (stops a stranger claiming a fresh public install); constant-time comparison                                                                                                                                           | `routes/auth.ts`                                                         |
| Public demo      | `DEMO_MODE` account is a viewer that cannot change its password, create tokens or be locked out; demo monitors target public services only                                                                                                                                       | `services/demo.ts`                                                       |
| Passwords        | argon2id (`@node-rs/argon2` defaults), 10–256 chars; constant-work path for unknown emails                                                                                                                                                                                       | `services/auth.ts`                                                       |
| Brute force      | 10 logins/min per IP; 10 consecutive failures lock the account 15 min; global 600 req/min/IP                                                                                                                                                                                     | `routes/auth.ts`, `services/auth.ts`, `app.ts`                           |
| Sessions         | 256-bit random token in httpOnly, SameSite=Lax, Secure (production) cookie; only SHA-256 stored; sliding expiry; deleted on logout; other sessions revoked on password change; all sessions revoked on disable/reset                                                             | `services/auth.ts`, `plugins/auth.ts`                                    |
| CSRF             | Required custom header `X-ContractRift-CSRF: 1` on unsafe methods + `Origin` must match `APP_URL`; no CORS enabled                                                                                                                                                               | `plugins/auth.ts`                                                        |
| AuthZ            | Role check on every route via `config.role`; API tokens are read-only (GET only), hashed, revocable, optional expiry                                                                                                                                                             | `plugins/auth.ts`, `services/tokens.ts`                                  |
| Secrets at rest  | AES-256-GCM (Node `crypto`), random 96-bit IV, auth tag; key from `ENCRYPTION_KEY`                                                                                                                                                                                               | `lib/crypto.ts`                                                          |
| Secret exposure  | Secrets are write-only in the API; response schemas whitelist fields; secret values redacted from stored response excerpts and error messages; pino redacts auth headers, cookies, passwords                                                                                     | `services/monitors.ts`, `routes/schemas.ts`, `probes/types.ts`, `app.ts` |
| SSRF             | Private/loopback/link-local/CGNAT/multicast/IPv4-mapped ranges refused unless `ALLOW_PRIVATE_TARGETS=true`; check happens in the DNS lookup used for the actual connection (covers redirects and DNS rebinding); IP literals and `*.localhost` checked up front; only http/https | `lib/http-client.ts`                                                     |
| Outbound limits  | Per-check timeout; 1 MB response cap; max 5 redirects and only when enabled; credentials stripped on cross-origin redirects                                                                                                                                                      | `lib/http-client.ts`                                                     |
| Input validation | JSON-schema validation of every body/query/param with unknown fields rejected; kind-specific monitor config validated; 512 KB body limit                                                                                                                                         | routes, `probes/index.ts`                                                |
| SQL injection    | Drizzle query builder / parameterized `sql` templates only; no `sql.raw`                                                                                                                                                                                                         | services                                                                 |
| XSS              | React escaping; no `dangerouslySetInnerHTML`; CSP `default-src 'self'; script-src 'self'; frame-ancestors 'none'` (styles allow inline)                                                                                                                                          | `app.ts`                                                                 |
| Headers          | helmet: CSP, `X-Content-Type-Options`, `Referrer-Policy`, HSTS when secure cookies; `Cache-Control: no-store` on API                                                                                                                                                             | `app.ts`                                                                 |
| Webhooks         | Optional HMAC-SHA256 signature over `timestamp.body`                                                                                                                                                                                                                             | `services/notifications.ts`                                              |
| Audit            | Logins (incl. failures, lockouts), user/monitor/channel/token/drift changes; never secret values                                                                                                                                                                                 | `services/audit.ts`                                                      |
| ReDoS            | User regexes ≤ 200 chars, nested quantifiers rejected, input capped at 64 KB                                                                                                                                                                                                     | `probes/assertions.ts`                                                   |

## Review performed (2026-09-28)

Checked: SQL injection, XSS, CSRF, SSRF, command injection (no `child_process`/`eval`), path
traversal (static files via `@fastify/static` root only; unknown asset paths 404), file uploads
(none exist), authentication bypass and authorization (integration tests for 401/403 per role,
read-only tokens, password-change gate), exposed secrets (tests assert secrets absent from API
responses, audit log, excerpts; git tree scanned for key patterns — none), unsafe logging
(redaction list), CORS (not enabled; test asserts no `Access-Control-Allow-Origin`), security
headers (tested), session handling (tested: hashing, expiry, logout invalidation).

Fixed during review: gate SQL bound to the wrong table (correctness), SPA fallback served HTML
for missing assets, Windows exit crash in the gate script, background jobs started before the
server was listening.

## Dependency scan

`npm audit` (2026-09-28): **0 vulnerabilities in production dependencies.** 4 _moderate_
advisories in dev dependencies, all via `drizzle-kit → @esbuild-kit/* → esbuild ≤ 0.24`
(GHSA-67mh-4wv8-2f99, esbuild dev-server CORS). drizzle-kit does not start esbuild's dev server;
the only offered fix is a major downgrade of drizzle-kit. **Accepted**; re-check on drizzle-kit
updates. CI runs `npm audit --omit=dev --audit-level=high`.

## Known limitations / residual risks

- **SSRF by design:** editors can make the server request any public URL (that is the product).
  With `ALLOW_PRIVATE_TARGETS=true` they can reach internal services — add network egress rules.
- **Credentials typed into the URL field** are stored and shown in plain text. Use secret headers
  or **secret URL parameters** (encrypted, appended only at request time, redacted from excerpts).
- **Key rotation** is supported via `ENCRYPTION_KEY_PREVIOUS` (see DEPLOYMENT.md). Changing the key
  _without_ listing the old one makes stored secrets unreadable (`CONFIG` errors).
- **No MFA / SSO**, no email-based password reset (admin reset and CLI recovery only).
- ReDoS protection is heuristic, not a linear-time engine.
- Ajv compiles user-supplied JSON Schemas (editor role only); extremely large schemas could
  consume CPU.
- Rate limiting is in-memory per process (not shared between instances).
- The CSP allows inline styles.
