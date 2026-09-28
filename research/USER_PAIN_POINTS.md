# User Pain Points (selected problem)

Source IDs: [SOURCES.md](SOURCES.md). Each pain point notes the evidence and how Tripline
addresses it (or doesn't).

| # | Pain point | Evidence | Addressed in MVP? |
|---|-----------|----------|-------------------|
| P1 | "The API still returns 200 but a field I use is gone/renamed/retyped." | S5 (GitHub, Stripe, Shopify examples), S1 | **Yes** — structural baseline learning + drift classification (breaking / warning / info) |
| P2 | Server-side validation tightened; requests that worked start 400-ing; SDK types say it's fine. | S5, S6 | **Yes** — scheduled real requests with expected-status assertions; incident opens after N consecutive failures |
| P3 | LLM alias silently points to a new model; outputs change with no error. | S2, S3 | **Yes (partial)** — LLM checks record the `model` the provider reports and flag changes; output assertions (contains/regex/JSON-schema). No semantic/LLM-judge scoring in MVP |
| P4 | MCP server is "up" but tools are broken or their schemas changed. | S12, S13 | **Yes** — MCP checks perform initialize + tools/list, snapshot tool input schemas, optionally call one tool and fail on `isError` |
| P5 | Expired/revoked credentials only discovered when a dormant job runs. | S12, S37 | **Yes (indirectly)** — authenticated probes run continuously, so 401/403 surfaces on schedule rather than at the dormant job's run time |
| P6 | Uptime tools need a hand-written assertion per field; nobody writes them for 40 fields. | S16–S19 | **Yes** — baseline is inferred automatically from real responses; optional JSON Schema and JSONPath assertions for the fields you care about |
| P7 | SaaS monitors need your production API keys. | Inference from S7/S21 being SaaS-only | **Yes** — self-hosted; secret headers encrypted at rest (AES-256-GCM) and never returned by the API |
| P8 | Too many alerts / no severity. | S7 (severity classification highlighted as differentiator) | **Yes** — drift severity, incident threshold (consecutive failures), one alert per incident open/resolve |
| P9 | "Can I deploy right now, or is an upstream broken?" | S7 gap: "No tool combines continuous monitoring with CI/CD deployment gates" | **Yes** — `GET /api/v1/gate` with API token + `scripts/tripline-gate.mjs` exits non-zero |
| P10 | Webhook delivery visibility | S24–S26 | **No** — out of scope (non-goal) |
| P11 | Model deprecation calendars | S31–S33 | **No** — out of scope; see ROADMAP |

## Personas (derived, not interviewed)

These personas are **constructed from the research**, not from user interviews. They must be
validated.

1. **Priya — backend lead at a 15-person SaaS.** Integrates Stripe, a shipping API, and OpenAI.
   Has been paged by customers twice this year for upstream changes. Security policy forbids
   giving production keys to new SaaS vendors. Wants: self-hosted, Slack alert, severity.
2. **Marco — solo AI app builder.** Uses OpenAI-compatible and Anthropic APIs plus 3 MCP servers.
   Wants to know when outputs or tool schemas change. Runs everything on one VPS.
3. **Dana — platform engineer.** Wants a deploy gate in CI that refuses to ship while a critical
   dependency is down or has unacknowledged breaking drift.
