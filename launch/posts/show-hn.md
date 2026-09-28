# Show HN

**Title** (≤ 80 chars, no emoji, no superlatives):

Show HN: ContractRift – detect silent changes in the APIs, LLMs and MCP servers you use

**URL:** https://github.com/ahmedgcompany-cyber/contractrift

**First comment (post immediately after submitting):**

Hi HN. ContractRift is a self-hosted monitor for third-party dependencies. Instead of only checking that an endpoint
returns 200, it learns the structure of normal responses and tells you when that structure changes: a field disappears,
a number becomes a string, a value starts coming back null.

The motivation was the stream of "the API changed under us" incidents: fields removed from GitHub and Stripe payloads,
OpenAI's Responses API starting to reject a previously valid input format, LLM aliases quietly pointing at new models.
Unit tests mock the old shape; integration tests only run on PRs; uptime checks see 200. The tools that do catch this
are SaaS, which means handing them your production API keys.

What it does:

- REST/JSON: baseline learned from the first N responses; removed/retyped fields are "breaking", new nulls "warning",
  new fields "info". Accept or dismiss each change.
- LLM APIs (OpenAI-compatible and Anthropic formats): alerts when the provider reports a different model, plus output
  assertions (regex, JSON Schema).
- MCP servers: supports the new stateless 2026-07-28 protocol and older initialize-based servers; flags removed tools
  and new required parameters.
- CI gate script that fails a deploy while a dependency is down or has unreviewed breaking drift.
- Secrets are encrypted at rest (with key rotation), outbound requests go through an SSRF guard.

Stack: TypeScript, Fastify, Drizzle, PostgreSQL (or embedded PGlite for single-node), React. One Docker container.
AGPL-3.0.

Known limits: drift is structural (value changes need explicit assertions), no load testing yet, alerts are
webhook/Slack only. I'd love feedback on the drift classification rules and on false positives with real-world APIs.

Live demo (read-only login on the sign-in page): <Render URL>
