# User Guide

## Concepts

| Term         | Meaning                                                                                                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Monitor**  | One dependency probed on a schedule: an HTTP endpoint, an LLM API or an MCP server.                                                                                                                                              |
| **Check**    | One probe run. Records status, latency, assertion results and (on failure) a redacted response excerpt.                                                                                                                          |
| **Baseline** | The response _structure_ learned from the first N successful checks: every JSON path, its types, and whether it was always present. Plus "tracked values" such as the LLM's reported model or an MCP tool's required parameters. |
| **Drift**    | A later response that differs structurally from the baseline.                                                                                                                                                                    |
| **Incident** | Opened when a monitor fails N checks in a row; resolved by the next success.                                                                                                                                                     |
| **Channel**  | Where notifications go: a webhook or a Slack incoming webhook.                                                                                                                                                                   |

## Roles

| Role   | Can                                                                              |
| ------ | -------------------------------------------------------------------------------- |
| Viewer | See everything except users, channels and the audit log; create own API tokens   |
| Editor | + create/edit/delete monitors, run checks, accept/dismiss drift, reset baselines |
| Admin  | + manage users, notification channels, view the audit log                        |

## First run

1. Open ContractRift and create the administrator account. If the server sets `SETUP_TOKEN`, enter it (on Render: service → Environment).
2. **Settings → Notifications → Add channel** so incidents and drift reach you.
3. **New monitor**.

## Creating a monitor

Pick the kind, then fill in the request. Use **Test configuration** to run the probe once
without saving anything — the result shows each check and how many JSON paths were observed.

### HTTP JSON API

- **URL, method, body, expected status codes** (empty = any 2xx).
- **Secret headers** (e.g. `Authorization: Bearer …`) are encrypted and never shown again.
  Put credentials here, **not in the URL** — URLs are stored and displayed in plain text.
- **Secret URL parameters** (e.g. `api_key`) for APIs that authenticate via the query string:
  stored encrypted and appended to the URL only when the request is sent.
- **Assertions** (optional): JSONPath subset `$.a.b[0].c` / `$["odd key"]` with operators
  `exists, notExists, equals, notEquals, contains, matches (regex), type, lt, gt`; and/or a
  JSON Schema for the whole body.
- Redirects are not followed unless enabled; when followed, credentials are stripped on
  cross-origin hops.

### LLM API

- **API format:** OpenAI-compatible Chat Completions (works with OpenAI and compatible gateways)
  or Anthropic Messages. Base URL defaults to the official endpoint.
- **API key** is stored encrypted.
- Keep the **prompt** short and deterministic (the form pre-fills 16 max output tokens; the API default is 32; temperature 0);
  every check costs tokens.
- **Output checks:** `contains / notContains` (case-insensitive), `equals`, `matches`,
  `jsonValid`, `jsonSchema` (Markdown code fences around JSON are tolerated).
- ContractRift records the **model the provider reports**. If it changes (e.g. an alias moved to
  a new snapshot) that is **warning** drift.

### MCP server

- Streamable HTTP endpoint URL; protocol **Auto** tries the 2026-07-28 stateless protocol
  (`server/discover`) and falls back to the initialize handshake.
- **Tools that must exist**, and optionally **one tool call** per check (use a harmless,
  read-only tool). A tool result with `isError: true` fails the check.
- Drift covers removed tools (breaking), changed required parameters (breaking), input-schema
  changes, and protocol version changes (warning).

### Schedule & drift settings

- **Check every** 30 s – 24 h; **timeout** must not exceed the interval.
- **Open an incident after** N consecutive failures (default 2).
- **Learn baseline from** N successful responses (default 3). Fields seen in every sample are
  "always present"; others are optional and their disappearance is not reported.
- **Ignored paths**: one per line, prefix match (e.g. `$.data[].metadata`) — for parts of a
  response whose structure legitimately varies (maps keyed by IDs, free-form metadata).
- Editing the request configuration or ignored paths **resets the baseline**.

## Monitor list

Monitors are listed by name, 25 per page, with search and filters by kind, status and tag.

## Monitor page

- **Run check now** records a real check (subject to a rate limit).
- **Pause/Resume**, **Edit**, **Delete** (deletes history permanently).
- Tabs: latency chart and configuration; check history (click a row for assertions, metadata
  and a redacted response excerpt); drift; baseline (paths, types, presence, tracked values,
  **Reset baseline**); incidents.

## Drift inbox

Each event lists changes with severity, path, before → after. The same change repeating does
not create new events; the occurrence count increases.

- **Accept as baseline** — the upstream change is intended; the observed structure becomes the
  baseline.
- **Dismiss** — mute this exact set of changes. A _different_ change still creates a new event.

## Notifications

Channels receive the events you tick: incident opened/resolved, breaking/warning/info drift.

- **Webhook** payload is JSON: `event, occurredAt, summary, monitor, incident | drift, link`.
  With a signing secret, verify `X-ContractRift-Signature: sha256=HMAC_SHA256(secret, X-ContractRift-Timestamp + "." + body)`.
- **Slack**: incoming-webhook URL (https only).
- Failed deliveries retry with exponential backoff (30 s, 1 min, 2 min, 4 min) and give up after
  5 attempts. See **Deliveries** per channel. **Send test** delivers immediately.

## CI deploy gate

1. **Settings → API tokens → Create token** (read-only, shown once).
2. In CI:

```bash
CONTRACTRIFT_URL=https://contractrift.example.com CONTRACTRIFT_TOKEN=cr_… \
  node scripts/contractrift-gate.mjs --tags payments --fail-on down,breaking
```

Exit codes: `0` pass, `1` a matching monitor is down / has open drift at the chosen severity,
`2` configuration or connection problem (including tags that match no monitor).

## Accounts

- Admins create users with an initial password; users must change it at first sign-in.
- Forgot password: an admin uses **Reset password** (shows a one-time temporary password).
  If no admin can sign in, run `npm run reset-password -w backend -- admin@example.com` on the server.
- 10 consecutive failed sign-ins lock an account for 15 minutes.
