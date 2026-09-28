# Tripline — Product Specification

> Working name. Several unrelated GitHub projects use similar names ("Driftline", "Plumbline");
> "Tripline" has **not** been trademark-cleared. See PROJECT_STATUS.md → Requires user action.

## 1. Concept

Tripline is a **self-hosted monitor for the external dependencies your application relies on**
— REST APIs, LLM APIs and MCP tool servers. It continuously sends real, authenticated probe
requests and tells you not only when a dependency is **down**, but when it has **silently
changed**: a field disappeared, a type changed, the provider now reports a different model
behind your alias, or an MCP server dropped or changed a tool.

## 2. Problem

Upstream APIs change without the consumer changing anything. Unit tests use frozen mocks,
integration tests run only on PRs, uptime monitors only check the status code, and the SaaS
drift monitors that exist require handing them your production API keys. Result: teams learn
about upstream changes from customers. Evidence: [research/PROBLEM_RESEARCH.md](research/PROBLEM_RESEARCH.md).

## 3. Target users

- Backend / platform engineers at small-to-mid SaaS companies integrating several third-party APIs.
- AI application and agent builders depending on LLM providers and MCP servers.
- Security-conscious teams that cannot give production credentials to a new SaaS vendor.

Personas: [research/USER_PAIN_POINTS.md](research/USER_PAIN_POINTS.md#personas-derived-not-interviewed)
(constructed from research, not interviews).

## 4. Value proposition

"Know when an upstream API, model or MCP server changes under you — before your users do —
without your API keys leaving your infrastructure."

## 5. Use cases

1. Monitor a Stripe/GitHub/partner endpoint; get a **breaking drift** alert when a field you rely on disappears.
2. Monitor an LLM endpoint with a fixed prompt; alert when it fails, slows down, stops satisfying
   output assertions, or reports a **different model** than the baseline.
3. Monitor an MCP server; alert when it's up but a tool is gone, a tool's required parameters
   changed, a tool call returns `isError`, or it switches protocol generation.
4. Gate deployments in CI: fail the pipeline if a tagged dependency is down or has
   unacknowledged breaking drift.
5. Review and **accept** intentional upstream changes so the baseline follows reality.

## 6. Core workflows

1. **First run:** open the app → create the admin account → dashboard.
2. **Create monitor:** choose kind (HTTP / LLM / MCP) → fill request details and secrets →
   "Test" (dry run, nothing saved) → save. The first N successful responses (default 3) build
   the baseline.
3. **Observe:** dashboard shows status, latency, open incidents and open drift.
4. **Incident:** after `failureThreshold` consecutive failures an incident opens and
   notifications fire; the first success resolves it.
5. **Drift:** a response whose structure deviates from the baseline creates a drift event
   (breaking / warning / info) and notifies. The user **accepts** (baseline updated) or
   **dismisses** (this exact change is muted).
6. **Gate:** CI calls `GET /api/v1/gate` with an API token (or runs `scripts/tripline-gate.mjs`).

## 7. MVP scope (v0.1)

- Monitor kinds: **HTTP(S) JSON**, **LLM** (OpenAI-compatible Chat Completions, Anthropic
  Messages), **MCP** (Streamable HTTP; modern 2026-07-28 stateless and legacy
  initialize-based servers).
- Assertions: expected status codes, max latency, JSONPath-subset assertions, JSON Schema
  (HTTP body / LLM JSON output), text contains/not-contains/regex (LLM output), expected tools
  and optional tool call (MCP).
- Automatic structural baseline + drift classification; ignore-paths; accept/dismiss workflow;
  baseline reset.
- Signature tracking: LLM reported model, MCP protocol version and per-tool required params / schema hash.
- Incidents with consecutive-failure threshold.
- Notifications: generic webhook (HMAC-SHA256 signed) and Slack incoming webhook; outbox with retries; test button; delivery log.
- Users with roles (admin / editor / viewer); session login; account lockout; admin password reset; audit log.
- Read-only API tokens; CI gate endpoint + script.
- Secrets encrypted at rest; SSRF protection with explicit opt-in for private targets.
- Result retention pruning.
- Web UI covering all of the above; OpenAPI spec.

## 8. Post-MVP scope

Email (SMTP) notifications, per-monitor channel routing, OpenAPI-spec-based expected shape,
GraphQL introspection drift, multi-region probe agents, public status pages, LLM-judge /
similarity assertions, Prometheus metrics endpoint, SSO/OIDC, drift history charts, import/export as config-as-code.

## 9. Explicit non-goals

- Not an APM or tracing product (no SDK in your app).
- Not a traffic proxy/gateway (does not sit in your request path).
- Not an inbound-webhook relay.
- Not an LLM evaluation platform (no datasets, no judge models in MVP).
- Not a status page product.

## 10. Differentiators

1. Self-hosted continuous drift detection (competitors found are SaaS-only).
2. REST + LLM + MCP in one tool with kind-specific probes.
3. Baseline learned automatically from real responses; no per-field assertions required.
4. Severity classification + accept/dismiss workflow.
5. CI gate on the same data.
6. MCP dual-protocol-generation probing.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Drift noise from dynamic keys (maps keyed by IDs) | `ignorePaths`; additions are only `info`; removals only flagged for paths present in every baseline sample |
| Probe costs money (LLM tokens) | Default `max_tokens` 32; minimum interval 30 s; documented cost note |
| Provider formats change (the very thing monitored) breaks the LLM probe | Text extraction is lenient; failures surface as probe errors, which is itself the signal |
| SSRF: the product intentionally requests user-configured URLs | Editor role required; private ranges blocked by default; DNS results checked at connect time |
| Single-node scheduler | Claims use `FOR UPDATE SKIP LOCKED`, so multiple instances against one PostgreSQL won't double-run a monitor |
| Crowded market | Positioning on self-hosting + LLM/MCP breadth; unvalidated commercially |

## 12. Assumptions (unvalidated)

- A meaningful segment prefers self-hosting specifically because of credential exposure.
- Structural (type-level) drift catches the majority of harmful upstream changes; value-level
  semantic changes are out of scope except for tracked signatures.
- Teams accept running one Node.js process + PostgreSQL.

## 13. Future opportunities

Hosted "control plane + self-hosted probe agent" model (credentials stay local, UI hosted);
curated drift feeds for popular public APIs; integration as a Gatus/Uptime Kuma external check;
MCP tool-definition security baselines (signed).
