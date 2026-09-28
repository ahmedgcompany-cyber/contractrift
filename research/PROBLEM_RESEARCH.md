# Problem Research

Date: 2026-09-28. Source IDs refer to [SOURCES.md](SOURCES.md).

## 1. Method

1. Broad web searches across DEV/blogs, GitHub issue trackers, Hacker News, vendor docs and
   pricing pages for recurring developer pain involving silent failure, reliability, and cost.
2. Six candidate problems were extracted.
3. For each: evidence of pain, existing solutions, gaps, feasibility of a quality MVP in this
   environment (Windows, Node 24, Python 3.14, no Docker, no local PostgreSQL server).
4. Decision matrix (Section 4). Scores are **judgement calls on qualitative evidence**, not
   measurements. The reasoning for each score is written next to it.

## 2. Candidate problems

### A. External API / AI / MCP dependencies break silently ("dependency contract drift")

**What happens.** Applications depend on third-party HTTP APIs, LLM APIs and (increasingly) MCP
tool servers. These change without the consumer changing anything:

- fields removed/renamed/re-typed (GitHub Events API removed `payload.commits`, Oct 2025;
  Stripe removed subscription billing fields, Mar 2025; Shopify changed `fulfillmentHold`,
  Jan 2025 — S5);
- server-side validation tightened (OpenAI Responses API began rejecting `input_text` in
  assistant messages on 2025-10-21 with HTTP 400; the SDK types still allowed it — S5, S6);
- floating model aliases silently move to new models; outputs change without errors (S2, S3);
- MCP servers return HTTP 200 while every tool is broken, credentials expire, tool schemas
  change between versions (S12, S13);
- credentials expire or are rotated and nothing notices until a dormant job runs (S37, S12).

**Why normal tooling misses it.** Unit tests use mocks frozen at an old response shape;
integration tests run on PRs, not continuously; uptime monitors only check "is it 200"; APM
treats a trickle of 400s as client error noise (S5). Uptime tools' body checks are keyword or
single-JSONPath checks the user must write by hand, per field (S16–S19).

**Who.** Any team integrating third-party APIs; especially AI/LLM app builders and agent
builders whose stack is mostly external dependencies.

**Frequency.** Reported (vendor-sourced, unverified) figure: 41% of public APIs show schema drift
within 30 days (S1). Provider incident counts: 114 Anthropic incidents in 90 days reported by
IsDown (S4, secondary). Independent evidence of *frequency* is weak; evidence of *recurrence*
(many named incidents across major providers) is strong.

**Impact.** Time: debugging starts from customer complaints rather than alerts (S5, S12).
Reliability: agents degrade quietly rather than crash (S12, S13). Security: credential-expiry
and MCP tool-definition changes are a supply-chain concern (S39, DriftCop in S7).

### B. Inbound webhooks fail silently
Endpoints go down, senders retry then give up; the receiver learns days later. GitHub doesn't
auto-redeliver (S24–S26). **Existing solutions are strong and cheap**: Hookdeck (free 100K
events/mo, paid from ~$39/mo — S27, S40), Svix, Convoy, Hook0. A new product requires public
ingress infrastructure to be useful, which we cannot test end-to-end here.

### C. Flaky tests waste CI time
Reported: 58% of developers hit flaky tests monthly; ~1 in 3 reruns caused by flakes (S28,
S29 — vendor-sourced). Real pain, but **mature, well-funded competitors** (Trunk, BuildPulse,
Datadog CI Visibility, Buildkite Test Engine — S30), and a useful product needs a GitHub App
plus real CI history we don't have.

### D. LLM model deprecations surprise teams
40 model IDs carry 2026 retirement dates (S33). Solutions already exist (llm-eol OSS tracker,
LLM Status CLI, Zombify, TokenGauge; LiteLLM adding it — S31–S33). The core value is a
**manually curated dataset**, not software; hard to differentiate.

### E. Cron / scheduled jobs fail silently
Well-understood; heartbeat ("dead man's switch") monitoring is a solved category (Cronitor,
Healthchecks.io OSS, Better Stack) (S34, S35). Low differentiation.

### F. Runaway LLM / agent spend
Anecdotes of multi-thousand-dollar surprise bills (S36). Solved at the gateway layer by LiteLLM
budgets, Portkey, Helicone, and provider-side spend limits. Differentiation mostly via proxy,
which is a large, security-sensitive surface.

## 3. Observations that shaped the choice

1. Candidate A is **not** an empty market (S7 lists ~15 tools). But the listed continuous drift
   monitors are **SaaS-only** (FlareCanary, API Drift Alert, APIShift, DiffMon, Rumbliq,
   PromptCanary), and the open-source tools are **CI-only snapshot tools** (oasdiff, Bellwether,
   Specmatic) — S7, S21.
2. To monitor *authenticated* endpoints (which is most real integrations: OpenAI, Stripe,
   internal partner APIs, MCP servers), a SaaS monitor must be given **your production API
   keys**. That is a concrete, defensible reason to want a self-hosted tool.
3. Self-hosted uptime tools (Uptime Kuma, Gatus) have large user bases and **repeated feature
   requests for richer response validation** (S16–S18) but no baseline learning / structural
   drift classification.
4. No surveyed tool combines, in one self-hosted package: generic REST checks, LLM-aware checks
   (model-alias drift, output assertions), MCP tool-schema drift, and a CI gate endpoint.

## 4. Decision matrix

Scale 1 (weak) – 5 (strong). "Feasibility here" accounts for this environment (no Docker, no
PostgreSQL server, no third-party credentials).

| Criterion | A. Dependency drift sentinel | B. Webhooks | C. Flaky tests | D. Model deprecations | E. Cron | F. LLM spend |
|---|---|---|---|---|---|---|
| Evidence of demand | 4 — many named incidents across major providers; issue-tracker requests; many new entrants (market signal) | 4 — frequent blog/forum complaints | 4 — multiple surveys (vendor) | 3 — trackers exist, LiteLLM feature request | 3 — long-standing, mostly solved | 3 — anecdotal |
| Frequency of pain | 4 | 4 | 5 | 2 — periodic | 3 | 2 |
| Technical feasibility (MVP) | 5 — HTTP + JSON + scheduler; testable locally against real local servers | 3 — needs public ingress | 2 — needs GitHub App + real CI data | 4 | 5 | 3 — proxy is security-heavy |
| Differentiation opportunity | 4 — self-hosted + LLM + MCP + CI gate gap | 2 — strong cheap incumbents | 2 — well-funded incumbents | 1 — data, not software | 1 | 2 |
| Implementation complexity (5 = manageable) | 4 | 3 | 2 | 4 | 5 | 2 |
| Commercial opportunity | 4 — paying SaaS competitors prove willingness to pay ($12–$749/mo, S7) | 4 | 4 | 2 | 3 | 3 |
| Useful MVP achievable here | 5 | 2 | 2 | 3 | 5 | 3 |
| Expansion potential | 5 — GraphQL, gRPC, OpenAPI diff, status pages, SaaS tier | 3 | 3 | 2 | 2 | 3 |
| **Total (/40)** | **35** | 25 | 24 | 21 | 27 | 21 |

## 5. Decision

**Selected: Candidate A**, scoped as a **self-hosted, open-source monitor for the external
dependencies an application relies on — REST APIs, LLM APIs and MCP servers — that detects not
only downtime but silent contract drift**, with a CI gate.

Why, in one paragraph: it has the most concrete, dated, multi-provider evidence of recurring
silent breakage; existing continuous-drift products are SaaS-only and require handing over
production credentials; existing self-hosted tools stop at hand-written per-field assertions;
and it can be built and genuinely tested end-to-end in this environment against real local HTTP
and MCP servers without faking anything.

The "AI/API Reliability Sentinel" idea from the brief was **not** adopted blindly: it scored
highest on the evidence, and it was narrowed (no general APM, no traffic proxy, no status pages
in MVP) and sharpened around the self-hosting/credential argument that the research surfaced.

## 6. Timing — why now

- LLM and agent stacks multiply external dependencies; providers ship server-side changes and
  alias moves continuously (S2, S5).
- MCP adoption created a new class of dependency whose failure mode is "HTTP 200, tools broken"
  (S12, S13) and with notable abandonment (S14).
- A wave of new SaaS drift tools in 2026 (DiffMon, PactFlow Drift, DriftCop — S7) signals
  market recognition, and leaves the self-hosted niche open.

## 7. Uncertainty statement

The strongest quantitative claims are vendor-sourced. We have **no primary evidence of
willingness to pay for a self-hosted version specifically**; this is an assumption to validate
(see PRODUCT_SPEC.md "Assumptions").
