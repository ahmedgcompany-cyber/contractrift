# Competitor Research

Date: 2026-09-28. Source IDs: [SOURCES.md](SOURCES.md). Pricing is as publicly reported at
research time and may have changed. Architectures are only described where public; nothing
proprietary was inspected or copied.

## 1. Continuous third-party drift monitors (SaaS)

| Product                       | Target                                     | Primary function                                                                        | Pricing (reported)                   | Strengths                             | Limitations (for our target user)                                  |
| ----------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------- | ------------------------------------------------------------------ |
| **FlareCanary** (flarecanary) | Teams consuming external APIs; AI builders | Polls live endpoints, learns baselines, severity-classified drift; monitors MCP servers | Free 5 endpoints → $19 → $49/mo (S7) | Multi-sample baselines, severity, MCP | SaaS only — needs your credentials; no CI gate (S7, self-reported) |
| **API Drift Alert**           | Mid/large teams                            | Severity-aware drift alerts, PagerDuty                                                  | $149–$749/mo, no free tier (S7)      | Alert routing                         | Expensive; SaaS                                                    |
| **APIShift**                  | Small teams                                | Drift + severity levels                                                                 | Free 5 APIs → $29 → $99/mo (S7)      | Severity                              | SaaS, limited public docs                                          |
| **DiffMon**                   | Small teams                                | HTML + JSON diffing                                                                     | Free 3 → $14 → $49/mo (S7)           | Cheap                                 | Schema validation paywalled; single-sample baseline                |
| **Rumbliq**                   | General                                    | Monitoring with JSON diffing                                                            | Free 25 → $12–$69/mo (S7, S9)        | Generous free tier                    | No severity / multi-sample baselines (S7)                          |
| **DriftMonitor**              | Teams on 3rd-party APIs                    | Response & schema drift vs baseline                                                     | Not captured                         | Focused                               | SaaS (S10)                                                         |
| **Apify drift actors**        | Scrapers/automation users                  | Check GET endpoints against OpenAPI schema                                              | Apify usage pricing                  | Cheap, spec-based                     | GET-only, needs OpenAPI (S11)                                      |

Architecture (public): all are hosted pollers; the user registers URL + headers (including
secrets) in the vendor's cloud.

## 2. LLM-specific synthetic monitoring

| Product                                                             | Function                                                                                                         | Pricing                                  | Strengths                            | Limitations                                        |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------ | -------------------------------------------------- |
| **PromptCanary**                                                    | Scheduled prompts against your AI endpoint; JSON schema, keyword, regex, latency, LLM-judge, similarity; CI gate | Free 2 monitors; paid not captured (S21) | Strong LLM assertion set incl. judge | SaaS only; not general REST/MCP                    |
| **Braintrust, Galileo, LangSmith, Arize** (LLM observability/evals) | Trace + eval platforms                                                                                           | Various                                  | Deep eval tooling                    | Instrument _your_ app; not dependency probes (S23) |

## 3. MCP-specific

| Product                        | Function                                          | Open source            | Limitations                                    |
| ------------------------------ | ------------------------------------------------- | ---------------------- | ---------------------------------------------- |
| **Bellwether**                 | Snapshot MCP tool schemas, diff in CI             | Yes                    | CI-only (S7)                                   |
| **DriftCop**                   | Diff MCP manifests vs signed baselines (SigStore) | Yes                    | Security focus, not continuous monitoring (S7) |
| **Specmatic MCP Auto-Test**    | Contract testing incl. MCP                        | Yes (MIT) + enterprise | Point-in-time CI (S7)                          |
| **Sentry MCP monitoring**      | Server-side instrumentation                       | No (SaaS)              | Requires owning/instrumenting the server (S15) |
| **Plumbline (GautamTalksDev)** | Public transparency log of MCP tool definitions   | Yes                    | Public registry, not your private servers      |

## 4. Self-hosted uptime monitors (closest open-source alternatives)

| Product             | Function                                | Response validation                                   | Gap                                                                                                     |
| ------------------- | --------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Uptime Kuma**     | Very popular self-hosted uptime monitor | Status, keyword, JSONata query (S16)                  | Repeated requests for richer validation (S16–S18); no baseline learning, no drift, no LLM/MCP awareness |
| **Gatus**           | Config-as-code health checks, Go        | JSONPath-ish conditions, `len()`, response time (S19) | Hand-written per-field conditions; no drift learning                                                    |
| **Healthchecks.io** | Heartbeat/cron                          | N/A                                                   | Different problem                                                                                       |

## 5. Synthetic API monitoring platforms

| Product                                     | Pricing                                                                 | Notes                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Checkly**                                 | Hobby free (10K API checks) → Starter $24/mo → Team $64/mo annual (S20) | Excellent monitoring-as-code; assertions are hand-written; SaaS (private locations exist on higher tiers) |
| Datadog Synthetics, New Relic, Better Stack | Usage-based                                                             | General purpose; hand-written assertions                                                                  |

## 6. CI-only contract/spec tools

**oasdiff** (OSS, 300+ rules), **PactFlow Drift**, **Bump.sh** ($50–$250/mo), **Tusk Drift**
(traffic replay). They compare _specs_ or _your_ API; they do not continuously probe third-party
production behavior (S7).

## 7. Gaps → Tripline positioning

1. **Self-hosted continuous drift detection.** Every continuous drift monitor found is SaaS.
   Tripline runs inside your network; probe credentials never leave it.
2. **One tool for REST + LLM + MCP.** Competitors specialize in one. Tripline covers the three
   dependency classes AI-era apps actually have, with type-specific probes.
3. **Automatic baseline, not hand-written assertions.** Unlike Uptime Kuma/Gatus/Checkly.
4. **CI deploy gate** on the same data (a gap S7 calls out explicitly).
5. **MCP protocol-generation aware** (legacy `initialize` vs 2026-07-28 stateless
   `server/discover`) — a real, current compatibility problem.

## 8. What competitors do better (honest)

- PromptCanary / LLM eval platforms: LLM-judge and similarity scoring (Tripline MVP has none).
- Checkly / Datadog: global multi-region probing, browser checks, mature alerting integrations.
- FlareCanary: hosted — zero ops. Tripline requires running a server and a database.
- Uptime Kuma: huge community, dozens of notification channels, status pages.

## 9. Open-source alternatives we could have extended instead

Extending Uptime Kuma or Gatus was considered. Rejected because baseline-learning drift,
drift acknowledgement workflow, LLM/MCP probe types and a gate API are a different data model
(per-monitor baselines and drift events) rather than a single new monitor type; and upstream
acceptance is outside our control. This is recorded as a reversible decision; a future
"Tripline as Gatus external endpoint" integration is listed in ROADMAP.md.
