# Roadmap

Priorities reflect research gaps ([research/](research/)) and known limitations
([PROJECT_STATUS.md](PROJECT_STATUS.md)). Nothing below is implemented.

## Next (0.2) — harden what exists

- Run CI on GitHub: confirm PostgreSQL 17 suite, Docker build, E2E on Linux.
- Real-provider verification with user-supplied keys (OpenAI, Anthropic, a public MCP server).
- `ENCRYPTION_KEY` rotation (dual-key decrypt + re-encrypt job).
- Secret **query parameters** for APIs that authenticate via the URL.
- Pagination for `GET /monitors` (payload is ~250 KB at 200 monitors).
- Retention for drift events / resolved incidents / audit log (configurable).
- Shared rate-limit store for multi-instance deployments.
- Auto-close stale open drift events when a later event is accepted for the same monitor.

## Soon (0.3) — product depth

- Email (SMTP) notifications; per-monitor channel routing; maintenance windows / snooze.
- OpenAPI-spec-derived expectations ("the upstream no longer matches its own published spec").
- GraphQL (introspection) and gRPC reflection drift.
- LLM checks: similarity/judge assertions, token/cost tracking per check, model deprecation calendar feed.
- MCP: resources/prompts listing, tool-definition security baselines (description changes flagged).
- Prometheus `/metrics`; OpenTelemetry traces for checks.
- Monitor import/export (config-as-code, YAML) and a Terraform/CLI workflow.

## Later — platform

- SSO (OIDC), MFA.
- Remote probe agents (run checks from several regions/networks; central UI).
- Optional hosted control plane with self-hosted agents (credentials never leave the customer).
- Public/status pages; curated drift feeds for popular public APIs.
- Integration as an external check for Gatus / Uptime Kuma.
