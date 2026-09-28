# Troubleshooting

Each entry: **Problem · Cause · Fix.** Logs are JSON (pino); every API error includes a
`request_id` that appears in the logs as `reqId`.

## Startup

**`Configuration error: ENCRYPTION_KEY is required` (exit 2)** · not set · `npm run gen-key`, put it in `.env`.

**`ENCRYPTION_KEY must be 32 bytes`** · wrong format · use the base64 output of `npm run gen-key` (44 chars).

**`EADDRINUSE`** · port taken · set `PORT`, or stop the other process. Background jobs only start after the port is bound.

**Blank page, console says CSS/JS has MIME type `application/json`/`text/html`** · the UI was rebuilt while the server was running (static files are indexed at startup) · restart the server after `npm run build`.

**`Route GET / was not found`** · `frontend/dist` missing · run `npm run build` (or set `FRONTEND_DIST`).

## Sign-in

**Login fails with no detail** · by design the message is generic · check the audit log (admin) for `auth.login_failed`/`auth.account_locked`.

**`ACCOUNT_LOCKED`** · 10 failed attempts · wait 15 min, or an admin resets the password (also unlocks), or `npm run reset-password -w backend -- <email>`.

**Every write returns `CSRF_REJECTED`** · (a) client doesn't send `X-ContractRift-CSRF: 1`; (b) the browser `Origin` differs from `APP_URL` (e.g. Vite on :5173 while `APP_URL` is :3000, or a proxy hostname) · fix the header / set `APP_URL` to the URL users actually open.

**Logged out immediately / cookie not stored** · `COOKIE_SECURE=true` over plain HTTP · use HTTPS, or `COOKIE_SECURE=false` for local testing only.

**`RATE_LIMITED` on login during scripted tests** · 10/min per IP by default · raise `AUTH_RATE_LIMIT_PER_MINUTE` for that environment only.

**Rate limits hit for everyone behind a proxy** · all requests appear from the proxy IP · `TRUST_PROXY=true`.

## Checks

| errorCode                    | Meaning / fix                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BLOCKED_TARGET`             | URL resolves to a private/loopback address. Intentional? set `ALLOW_PRIVATE_TARGETS=true` (read SECURITY.md).                                                                    |
| `TIMEOUT`                    | No full response within `timeoutMs`. Raise the timeout or check the upstream.                                                                                                    |
| `DNS` / `CONNECTION` / `TLS` | Name resolution, TCP, or certificate problems from the ContractRift host.                                                                                                        |
| `HTTP_STATUS`                | Status not in `expectedStatus` (empty = 2xx). A 3xx means redirects are off.                                                                                                     |
| `AUTH`                       | 401/403 — key expired/rotated or wrong header. Re-enter the secret.                                                                                                              |
| `RATE_LIMITED`               | Provider returned 429; increase the interval.                                                                                                                                    |
| `PROTOCOL`                   | LLM/MCP response didn't have the expected structure (possibly a real upstream format change), or an MCP server supports neither protocol generation. Check the response excerpt. |
| `RESPONSE_TOO_LARGE`         | Body > 1 MB. Query a smaller resource (e.g. `?limit=1`).                                                                                                                         |
| `CONFIG`                     | Secrets can't be decrypted — `ENCRYPTION_KEY` changed. Put the old key in `ENCRYPTION_KEY_PREVIOUS` and restart, or re-enter the secrets.                                        |
| `ASSERTION` / `LATENCY`      | See the check's assertion list.                                                                                                                                                  |

**Monitor never runs** · paused, or `SCHEDULER_ENABLED=false` on every instance · resume / enable a scheduler.

**MCP: `Session expired (HTTP 404)`** · legacy server dropped the session mid-check · usually transient; each check starts a new session.

## Drift

**Drift events on every check for maps keyed by IDs or free-form metadata** · structure legitimately varies · add those paths to _Ignored paths_ (resets the baseline), then accept/dismiss the open events.

**Expected drift but none** · baseline still learning (see Baseline tab), drift disabled, the response wasn't a "normal" one (unexpected status or non-JSON → drift skipped), the change is value-only (types unchanged), the field was optional in the baseline, or the same change was dismissed earlier.

**Accept returns `CONFLICT … baseline was reset`** · baseline deleted after the event · dismiss it; the new baseline is learned automatically.

## Notifications

**Deliveries `failed` after 5 attempts** · receiver non-2xx/unreachable/timeout (10 s) · see _Deliveries_ for the last error; _Send test_ retries immediately. Private receiver? needs `ALLOW_PRIVATE_TARGETS=true`.

**Signature mismatch on the receiver** · must HMAC `timestamp + "." + rawBody` with the channel secret, using the raw body bytes.

## Development

**`npx biome` / other unsigned `.exe` fails with `spawnSync … UNKNOWN` on Windows** · Windows Application Control blocks unsigned binaries · this repo uses ESLint/Prettier (pure JS) instead.

**Playwright: browser executable missing** · install with `npx playwright install chromium`, or use installed Chrome: `PW_CHANNEL=chrome npm run test:e2e`.

**Integration tests with `TEST_DATABASE_URL` wipe my data** · by design they drop the `public` and `drizzle` schemas · point it at a throwaway database only.

**`api/openapi.yaml` test fails** · route schemas changed · `npm run openapi` and commit.
