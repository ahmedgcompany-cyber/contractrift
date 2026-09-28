# Marketing Context

Every claim is labelled **CURRENTLY IMPLEMENTED**, **PLANNED** (on the roadmap) or **FUTURE**
(idea, not scheduled). Do not market PLANNED/FUTURE items as available. Do not publish
performance, adoption or customer claims — none exist yet.

## Product overview

Tripline is a self-hosted monitor for the third-party dependencies an application relies on —
REST APIs, LLM APIs and MCP tool servers. It detects outages **and** silent changes: removed or
re-typed fields, a different model behind your LLM alias, a missing MCP tool.

One-liner: **"Know when your upstreams change — before your users do. Your keys never leave your servers."**

## Target users

- Backend/platform engineers at SaaS companies with several critical API integrations.
- AI application and agent builders depending on LLM providers and MCP servers.
- Security-conscious teams that won't hand production API keys to another SaaS vendor.

## Customer problems (from research)

- Upstream APIs change without notice; tests use frozen mocks; uptime checks only see "200 OK".
- LLM aliases move to new models silently; outputs change without errors.
- MCP servers can be "up" while tools are broken or changed.
- Existing drift monitors are SaaS and need your credentials.

## Benefits & features

| Benefit                                         | Feature                                                                                          | Status                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------- |
| Catch breaking upstream changes early           | Learned structural baseline + severity-classified drift                                          | CURRENTLY IMPLEMENTED |
| No hand-written assertions for every field      | Baseline inferred from real responses                                                            | CURRENTLY IMPLEMENTED |
| Keep credentials in-house                       | Self-hosted; AES-256-GCM encrypted, write-only secrets                                           | CURRENTLY IMPLEMENTED |
| Watch AI dependencies                           | LLM checks (OpenAI-compatible, Anthropic) with output assertions and model-change detection      | CURRENTLY IMPLEMENTED |
| Watch agent tools                               | MCP checks (2026-07-28 and older servers), tool presence, required-param changes, test tool call | CURRENTLY IMPLEMENTED |
| Don't deploy into a broken dependency           | CI gate endpoint + script                                                                        | CURRENTLY IMPLEMENTED |
| Right people notified                           | Signed webhooks, Slack, retries                                                                  | CURRENTLY IMPLEMENTED |
| Team use                                        | Roles, API tokens, audit log                                                                     | CURRENTLY IMPLEMENTED |
| Email alerts, per-monitor routing               |                                                                                                  | PLANNED               |
| OpenAPI/GraphQL-based expectations              |                                                                                                  | PLANNED               |
| LLM quality scoring (judge/similarity)          |                                                                                                  | PLANNED               |
| SSO/MFA                                         |                                                                                                  | FUTURE                |
| Multi-region probe agents, hosted control plane |                                                                                                  | FUTURE                |

## Differentiators

1. Self-hosted continuous drift detection (competitors found in research are SaaS-only).
2. REST + LLM + MCP in one tool.
3. Automatic baseline instead of per-field assertions.
4. Accept/dismiss workflow and a CI gate on the same data.

## Positioning

"Uptime Kuma tells you it's up. Tripline tells you it's still the same."
Between generic uptime monitors (too shallow) and APM/LLM-observability suites (instrument your
own app, not your dependencies).

## Objections & honest answers

- _"I can write assertions in Checkly/Gatus."_ — Yes, per field. Tripline learns the whole structure and flags what you didn't think to assert.
- _"Another thing to host."_ — One Node process; PostgreSQL optional for small installs (embedded). SaaS competitors avoid hosting but need your keys.
- _"LLM checks cost tokens."_ — Short fixed prompts, default ≤ 32 output tokens, interval ≥ 30 s you choose.
- _"Is it production-ready?"_ — v0.1: tested extensively against local substitutes; not yet proven against real providers or at scale (see PROJECT_STATUS.md).
- _"Noise?"_ — Additions are info-level; optional fields don't alert; ignored paths; dedup; dismiss.

## FAQ

- **Does it proxy my traffic?** No. It sends its own probe requests.
- **Where are keys stored?** Encrypted in your database with a key you control.
- **Which MCP transports?** Streamable HTTP only (not stdio) — CURRENTLY IMPLEMENTED.
- **Kubernetes/Helm?** Not provided — FUTURE.

## Customer scenarios

1. Payments team: Stripe endpoint monitored; a field removal triggers a breaking-drift Slack alert and fails the deploy gate until reviewed.
2. AI startup: alias `gpt-…` starts reporting a new snapshot; warning drift prompts an eval run before users notice tone changes.
3. Agent platform: an MCP server adds a required parameter to `search`; breaking drift before agents start failing.

## Demo script (works today, no real credentials)

1. `npm run upstreams -w backend`, start Tripline with `ALLOW_PRIVATE_TARGETS=true`, seed `--upstreams http://127.0.0.1:4010`.
2. Show dashboard → monitor detail → baseline tab.
3. `curl -X POST localhost:4010/__control -d '{"json":{"body":{"id":"1"}}}' -H 'content-type: application/json'`, click _Run check now_, open the drift inbox, accept.
4. Show the gate script failing, then passing after accept.

## Landing-page concepts

- Hero: seismograph line with a single orange spike — "Your dependencies changed at 03:12. You found out at 03:12."
- Three columns: REST · LLM · MCP.
- "Keys stay home" section with the self-hosting diagram.
- Code block: the CI gate.
