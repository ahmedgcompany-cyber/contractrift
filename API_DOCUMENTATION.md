# API Documentation

Base path: `/api/v1`. JSON in and out. The machine-readable spec is
[api/openapi.yaml](api/openapi.yaml) (also served at `GET /api/v1/openapi.json`); it is generated
from the same schemas that validate requests, and a test fails if the committed file is stale.

## Authentication

| Method         | How                                                                                                            | Allowed                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Session cookie | `POST /auth/login` or `/auth/setup` sets `contractrift_session` (httpOnly, SameSite=Lax, Secure in production) | Everything the user's role allows             |
| API token      | `Authorization: Bearer cr_…` (create in the UI or `POST /tokens`)                                              | **GET requests only**; any other method → 403 |

**CSRF:** every `POST/PATCH/PUT/DELETE` without a bearer token must include
`X-ContractRift-CSRF: 1`; if an `Origin` header is present it must equal the origin of `APP_URL`.
Missing/mismatched → `403 CSRF_REJECTED`.

**Roles:** `viewer` < `editor` < `admin`. Each endpoint below lists the minimum role.
Users flagged `mustChangePassword` get `403 PASSWORD_CHANGE_REQUIRED` everywhere except
`/auth/me`, `/auth/logout`, `/auth/change-password`.

## Errors

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid http monitor configuration.",
    "request_id": "3f0c…",
    "details": [{ "path": "config/url", "message": "must match pattern \"^https?://\"" }]
  }
}
```

| HTTP | code                                                                 |
| ---- | -------------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR` (unknown body fields are rejected), `BAD_REQUEST` |
| 401  | `UNAUTHENTICATED`                                                    |
| 403  | `FORBIDDEN`, `CSRF_REJECTED`, `PASSWORD_CHANGE_REQUIRED`             |
| 404  | `NOT_FOUND`                                                          |
| 409  | `CONFLICT`, `SETUP_ALREADY_DONE`                                     |
| 413  | `PAYLOAD_TOO_LARGE` (body > 512 KB)                                  |
| 423  | `ACCOUNT_LOCKED`                                                     |
| 429  | `RATE_LIMITED`                                                       |
| 500  | `INTERNAL` (details only in server logs; quote `request_id`)         |

Every response carries `X-Request-Id` (an incoming `X-Request-Id` matching `[\w-]{1,64}` is reused).

## Rate limits

Global 600 requests/min per IP. Stricter: `POST /auth/login`, `/auth/setup`,
`/auth/change-password` 10/min (`AUTH_RATE_LIMIT_PER_MINUTE`); `POST /monitors/test` and `/monitors/:id/run` 30/min;
`POST /channels/:id/test` 10/min.

## Endpoints

| Method & path                    | Role                        | Purpose                                                                                                                                                 |
| -------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/auth/setup-status`         | public                      | `{ needsSetup, setupTokenRequired, demo? }` — `demo` holds the public demo credentials when `DEMO_MODE` is on                                           |
| POST `/auth/setup`               | public (only while 0 users) | `{ email, name, password, setupToken? }` → 201 `{ user }` + cookie; `setupToken` required when the server sets `SETUP_TOKEN`                            |
| POST `/auth/login`               | public                      | `{ email, password }` → `{ user }` + cookie                                                                                                             |
| POST `/auth/logout`              | viewer                      | 204; deletes the session                                                                                                                                |
| GET `/auth/me`                   | viewer                      | `{ user, via: "session" \| "token" }`                                                                                                                   |
| POST `/auth/change-password`     | viewer (session)            | `{ currentPassword, newPassword }` → 204; signs out other sessions                                                                                      |
| GET `/users`                     | admin                       | `{ users }`                                                                                                                                             |
| POST `/users`                    | admin                       | `{ email, name, role, password }` → 201 (user must change password)                                                                                     |
| PATCH `/users/:id`               | admin                       | `{ name?, role?, disabled? }` (last active admin protected)                                                                                             |
| POST `/users/:id/reset-password` | admin                       | `{ temporaryPassword }` (shown once)                                                                                                                    |
| DELETE `/users/:id`              | admin                       | 204 (not self, not last admin)                                                                                                                          |
| GET `/tokens`                    | viewer                      | own tokens (no values)                                                                                                                                  |
| POST `/tokens`                   | viewer (session)            | `{ name, expiresInDays? }` → 201 `{ token, apiToken }` — value shown once                                                                               |
| DELETE `/tokens/:id`             | viewer                      | revoke own token                                                                                                                                        |
| GET `/monitors`                  | viewer                      | `?q=&kind=&status=&tag=&limit=1..200 (50)&offset=` → `{ monitors, total, limit, offset }`; each item incl. `recent` (last 30 `{d, ok}`) and `openDrift` |
| POST `/monitors`                 | editor                      | create (see below) → 201 `{ monitor }`                                                                                                                  |
| POST `/monitors/test`            | editor                      | dry run, nothing stored: `{ kind, config, secrets?, timeoutMs?, monitorId? }`                                                                           |
| GET `/monitors/:id`              | viewer                      | `{ monitor }`                                                                                                                                           |
| PATCH `/monitors/:id`            | editor                      | partial update; changing `config`/`ignorePaths` resets the baseline                                                                                     |
| DELETE `/monitors/:id`           | editor                      | 204; deletes all history                                                                                                                                |
| POST `/monitors/:id/run`         | editor                      | run + record now → `{ result, status, incident, baseline, drift }`                                                                                      |
| GET `/monitors/:id/results`      | viewer                      | `?limit≤500&before=<id>` newest first                                                                                                                   |
| GET `/monitors/:id/baseline`     | viewer                      | `{ state, samples, samplesRequired, paths[], signature, … }`                                                                                            |
| DELETE `/monitors/:id/baseline`  | editor                      | 204; relearn                                                                                                                                            |
| GET `/drift`                     | viewer                      | `?status=open\|accepted\|dismissed&monitorId=&limit`                                                                                                    |
| GET `/drift/:id`                 | viewer                      | `{ event }`                                                                                                                                             |
| POST `/drift/:id/accept`         | editor                      | observed structure becomes the baseline                                                                                                                 |
| POST `/drift/:id/dismiss`        | editor                      | mute this exact change set                                                                                                                              |
| GET `/incidents`                 | viewer                      | `?status=open\|resolved&monitorId=&limit`                                                                                                               |
| GET `/channels`                  | admin                       | `{ channels }` (URL/secret never returned; `target` = host)                                                                                             |
| POST `/channels`                 | admin                       | `{ name, kind: webhook\|slack, url, secret?, events?, enabled? }`                                                                                       |
| PATCH `/channels/:id`            | admin                       | `{ name?, url?, secret? (null removes), events?, enabled? }`                                                                                            |
| DELETE `/channels/:id`           | admin                       | 204                                                                                                                                                     |
| POST `/channels/:id/test`        | admin                       | `{ ok, status?, error? }`                                                                                                                               |
| GET `/channels/:id/deliveries`   | admin                       | recent deliveries                                                                                                                                       |
| GET `/summary`                   | viewer                      | dashboard counters                                                                                                                                      |
| GET `/gate`                      | viewer (token)              | `?tags=a,b&failOn=down,unknown,breaking,warning` (default `down,breaking`) → always 200 with `{ pass, evaluated, failures[] }`                          |
| GET `/audit`                     | admin                       | `?limit&before`                                                                                                                                         |
| GET `/healthz`, `/readyz`        | public (outside `/api`)     | liveness; DB readiness (503 if DB unreachable)                                                                                                          |

## Monitor body

Common fields (all optional except `name`, `kind`, `config`):

```json
{
  "name": "Stripe customers", "kind": "http",
  "enabled": true, "intervalSeconds": 300, "timeoutMs": 10000,
  "failureThreshold": 2, "baselineSamples": 3, "driftEnabled": true,
  "ignorePaths": ["$.data[].metadata"], "tags": ["payments"],
  "config": { … },
  "secrets": { "headers": { "Authorization": "Bearer sk_live_…" }, "query": { "api_key": "…" }, "apiKey": "…" }
}
```

Limits: interval 30–86 400 s; timeout 500–60 000 ms and ≤ interval; threshold 1–20; samples 1–20;
≤ 50 ignore paths; ≤ 20 tags matching `[A-Za-z0-9_.-]+` (stored lower-case).

**Secrets are write-only.** Responses expose `secretKeys: { headers: [names], query: [names], apiKey: bool }`.
`secrets.query` parameters are appended to the request URL at send time (never stored in `config.url`).
On PATCH, `null` removes a secret and omitting keeps it.

### `config` for `kind: "http"`

| Field             | Default  |                                                                                                         |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `url`             | required | `http(s)://…`                                                                                           |
| `method`          | `GET`    | GET POST PUT PATCH DELETE HEAD OPTIONS                                                                  |
| `headers`         | `{}`     | non-secret headers                                                                                      |
| `body`            | —        | ≤ 64 KB; content-type inferred if not set                                                               |
| `expectedStatus`  | `[]`     | empty = 200–299                                                                                         |
| `maxLatencyMs`    | —        |                                                                                                         |
| `followRedirects` | `false`  | max 5; credentials stripped cross-origin                                                                |
| `assertions`      | `[]`     | `{ path: "$.a[0].b", op, value? }`; ops `exists notExists equals notEquals contains matches type lt gt` |
| `jsonSchema`      | —        | JSON Schema for the body (Ajv, draft-07 default)                                                        |

### `config` for `kind: "llm"`

| Field              | Default                                                   |                                                                                                                 |
| ------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `provider`         | required                                                  | `openai` (POST `{baseUrl}/chat/completions`, Bearer) or `anthropic` (POST `{baseUrl}/v1/messages`, `x-api-key`) |
| `baseUrl`          | `https://api.openai.com/v1` / `https://api.anthropic.com` |                                                                                                                 |
| `model`, `prompt`  | required                                                  |                                                                                                                 |
| `system`           | —                                                         |                                                                                                                 |
| `maxTokens`        | 32                                                        | 1–4096                                                                                                          |
| `temperature`      | 0                                                         | 0–2                                                                                                             |
| `anthropicVersion` | `2023-06-01`                                              | header value                                                                                                    |
| `headers`          | `{}`                                                      |                                                                                                                 |
| `textAssertions`   | `[]`                                                      | `{ op, value? }`; ops `contains notContains equals matches jsonValid jsonSchema`                                |
| `maxLatencyMs`     | —                                                         |                                                                                                                 |

Secret: `secrets.apiKey`.

### `config` for `kind: "mcp"`

| Field           | Default  |                                                                                                           |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `url`           | required | Streamable HTTP endpoint                                                                                  |
| `protocol`      | `auto`   | `auto` \| `modern` (2026-07-28 `server/discover`) \| `legacy` (initialize handshake, requests 2025-11-25) |
| `headers`       | `{}`     |                                                                                                           |
| `expectedTools` | `[]`     | tool names that must exist                                                                                |
| `toolCall`      | —        | `{ name, arguments, expectText? }`; fails on JSON-RPC error or `isError: true`                            |
| `maxLatencyMs`  | —        | total over all requests                                                                                   |

Regex values are limited to 200 characters and patterns with nested quantifiers are rejected.

## Check result `errorCode` values

`TIMEOUT, DNS, CONNECTION, TLS, BLOCKED_TARGET, RESPONSE_TOO_LARGE (>1 MB), INVALID_URL, NETWORK,
HTTP_STATUS, LATENCY, ASSERTION, AUTH (401/403), RATE_LIMITED (429 from LLM provider), PROTOCOL,
CONFIG (secrets not decryptable), INTERNAL`.

## Examples

```bash
# sign in (cookie jar), create a monitor, run it
curl -c jar -H 'X-ContractRift-CSRF: 1' -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"…"}' http://localhost:3000/api/v1/auth/login
curl -b jar -H 'X-ContractRift-CSRF: 1' -H 'content-type: application/json' \
  -d '{"name":"GitHub repo","kind":"http","config":{"url":"https://api.github.com/repos/nodejs/node"}}' \
  http://localhost:3000/api/v1/monitors
curl -b jar -X POST -H 'X-ContractRift-CSRF: 1' http://localhost:3000/api/v1/monitors/<id>/run

# CI gate with a token
curl -H "Authorization: Bearer $CONTRACTRIFT_TOKEN" 'http://localhost:3000/api/v1/gate?tags=payments'
```

## Webhook payload

Headers: `X-ContractRift-Event`, `X-ContractRift-Delivery` (uuid), and with a secret
`X-ContractRift-Timestamp` + `X-ContractRift-Signature: sha256=<hex HMAC-SHA256(secret, timestamp + "." + body)>`.

```json
{
  "event": "drift.breaking",
  "occurredAt": "2026-09-28T16:02:11.000Z",
  "summary": "BREAKING DRIFT: Widgets API — 2 changes vs. baseline.",
  "monitor": { "id": "…", "name": "Widgets API", "kind": "http" },
  "drift": {
    "id": "…",
    "severity": "breaking",
    "changes": [
      { "path": "$.owner.email", "message": "Field $.owner.email (always present in the baseline) is missing.", "severity": "breaking" }
    ]
  },
  "link": "https://contractrift.example.com/monitors/…"
}
```

Incident events carry `incident: { id, cause, openedAt, resolvedAt? }` instead of `drift`.
Receivers should respond 2xx within 10 s; verify the signature and reject stale timestamps.
