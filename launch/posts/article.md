---
title: Your tests mock the API. The API changed anyway.
tags: api, devops, opensource, ai
---

In the last year, some of the most frustrating production issues I've seen weren't outages. The dependency was up.
It returned `200 OK`. It just didn't return the same thing anymore.

- A field our code relied on was removed from a well-known API's payload.
- An LLM provider started rejecting a request format that was valid the week before; the SDK types still allowed it.
- A model alias quietly pointed at a new snapshot, and our support bot's tone changed overnight.
- A remote MCP server added a required parameter to a tool, and every agent calling it started failing.

## Why our safety nets missed it

**Unit tests** mock the response shape we saw when we wrote them. **Integration tests** run on pull requests, not when
the provider deploys. **Uptime monitors** check the status code. **APM** sees a trickle of 4xx errors and files them
under "client error". Nothing is watching the _contract_ between us and the provider.

## Watching the contract

The approach I ended up with:

1. **Probe on a schedule** with real (authenticated) requests.
2. **Learn a structural baseline** from the first N successful responses: every JSON path and the types seen there,
   and whether it was always present.
3. **Diff each new response** against the baseline and classify:
   - a field that was always present is gone → **breaking**
   - a type changed (number → string, object → array) → **breaking**
   - a field is newly `null` → **warning**
   - a new field appeared → **info**
4. **Track a few exact values** that matter: the model an LLM provider reports, an MCP tool's required parameters.
5. **Deduplicate** by fingerprinting the change set, and let a human **accept** (update the baseline) or **dismiss**.
6. **Gate deploys** on unreviewed breaking drift.

Details that turned out to matter: don't report children of a field that became `null` (report the parent once); don't
report elements of arrays that were always empty in the baseline; let users ignore paths like maps keyed by IDs.

## Keys stay home

Monitoring authenticated endpoints means the monitor holds your API keys. That was the reason I built this as a
self-hosted tool: secrets are encrypted at rest (AES-256-GCM, rotatable), never returned by the API, and every outbound
request goes through an SSRF guard.

## Try it

ContractRift is open source (AGPL-3.0): https://github.com/ahmedgcompany-cyber/contractrift — live demo: https://136-119-147-140.sslip.io

```bash
docker run -d -p 3000:3000 -v contractrift:/data \
  -e ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  ghcr.io/ahmedgcompany-cyber/contractrift:latest
```

I'd love to hear where the drift rules produce false positives on the APIs you use.
