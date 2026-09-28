# X / Twitter thread

1/ Your tests mock the API. The API changed anyway.
I built ContractRift: an open-source, self-hosted monitor that tells you when the APIs, LLMs and MCP servers you depend on
go down — or silently change. 🧵
[attach assets/screenshots/dashboard-light.png]

2/ Uptime checks see "200 OK". Your code sees a missing field.
ContractRift learns the structure of normal responses and flags drift: removed or retyped fields = breaking, new nulls =
warning, new fields = info.
[attach drift-inbox.png]

3/ LLM APIs: it records which model the provider actually reports. When your alias quietly moves to a new snapshot,
you get a warning before your users notice the tone change.

4/ MCP servers: supports the new stateless 2026-07-28 protocol and older ones. Removed tool or new required parameter
= breaking drift, before your agents start failing.

5/ Your keys stay on your servers: AES-256-GCM encrypted secrets, key rotation, SSRF guard. Plus a CI gate that blocks
deploys while a dependency has unreviewed breaking drift.

6/ AGPL-3.0, one Docker container. Try the live demo: https://136-119-147-140.sslip.io
Code: https://github.com/ahmedgcompany-cyber/contractrift

# LinkedIn

Many "external dependency" incidents aren't outages — they're contract changes. A field disappears from a payment API
response. A model alias points to a new snapshot. An MCP tool gains a required parameter. Everything still returns
200 OK, so monitoring stays green while customers hit errors.

I've released ContractRift, an open-source (AGPL-3.0), self-hosted monitor that learns what your third-party APIs, LLM
endpoints and MCP servers normally return and alerts when that contract breaks — with a review inbox, Slack/webhook
alerts and a CI deploy gate. Because it's self-hosted, the API keys it needs stay inside your infrastructure.

If your team depends on external APIs or AI providers, I'd value your feedback.
Live demo: https://136-119-147-140.sslip.io
Code: https://github.com/ahmedgcompany-cyber/contractrift

#APIs #DevOps #SRE #AI #MCP #OpenSource
