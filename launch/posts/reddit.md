# Reddit posts

Read each subreddit's rules first; some require a flair or only allow self-promotion on certain days.

## r/selfhosted

**Title:** I built ContractRift: a self-hosted monitor that tells you when third-party APIs silently change (open source)

**Body:**
Uptime Kuma tells me my dependencies are up. It doesn't tell me when an API I rely on quietly drops a field or starts
returning a string where it used to return a number, which is what actually broke things for me.

ContractRift learns what normal responses look like and flags structural drift (breaking / warning / info), with a small
inbox to accept or dismiss each change. It also understands LLM APIs (model changes behind an alias) and MCP servers.

Why self-hosted matters here: to monitor authenticated endpoints you have to give the monitor your API keys. The SaaS
tools in this space all need them; ContractRift keeps them encrypted on your own box.

- Docker: `docker run -p 3000:3000 -v contractrift:/data -e ENCRYPTION_KEY=$(openssl rand -base64 32) ghcr.io/ahmedgcompany-cyber/contractrift`
- Compose with PostgreSQL included; PGlite (embedded Postgres) for single-node
- Webhooks (HMAC-signed) and Slack, roles, API tokens, audit log
- AGPL-3.0

Live demo (read-only): https://136-119-147-140.sslip.io
Repo: https://github.com/ahmedgcompany-cyber/contractrift — feedback very welcome, especially false positives on real APIs.

## r/devops / r/sre

**Title:** Catching upstream API contract changes before they become incidents (open-source tool + approach)

**Body:** (lead with the problem and the approach; link at the end)
Most of our "external dependency" incidents weren't outages, they were contract changes: removed fields, stricter
validation, an LLM alias pointing at a new model. Here's the approach I ended up building into an open-source tool:
learn a structural baseline from N successful responses, diff each new response, classify severity (removed/retyped =
breaking, newly null = warning, added = info), dedupe by fingerprint, and gate deploys on unreviewed breaking drift.
… (then 3–4 bullets from the r/selfhosted post) … Repo: https://github.com/ahmedgcompany-cyber/contractrift

## r/mcp

**Title:** Monitoring MCP servers for tool/schema drift (supports the 2026-07-28 stateless protocol)

**Body:**
If your agents depend on remote MCP servers, a server can stay "up" while a tool disappears or gains a required
parameter. ContractRift probes MCP servers on a schedule (server/discover for 2026-07-28 servers, initialize for older
ones, JSON and SSE), snapshots each tool's input schema, and alerts on removed tools / changed required params / failing
test tool calls. Tested against Hugging Face's and DeepWiki's public MCP servers. Open source (AGPL-3.0):
https://github.com/ahmedgcompany-cyber/contractrift
