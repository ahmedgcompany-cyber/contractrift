# Product Hunt

**Name:** ContractRift
**Tagline (≤ 60):** Know when the APIs and LLMs you depend on silently change
**Topics:** Developer Tools, Open Source, APIs, Artificial Intelligence

**Description (≤ 260):**
Open-source, self-hosted monitor for your third-party REST APIs, LLM endpoints and MCP servers. It learns what normal
responses look like and alerts you on outages and silent contract changes — before customers notice. Your API keys
never leave your servers.

**Gallery:** assets/screenshots/dashboard-light.png, drift-inbox.png, monitor-detail.png, monitor-form.png, dashboard-dark.png

**Maker comment:**
I built ContractRift after too many incidents where a dependency was "up" but had changed: a removed field, a new
validation rule, a model alias moved to a new snapshot. It learns a structural baseline, classifies each change by
severity and gives you an inbox to accept or dismiss it, plus a CI gate. It speaks OpenAI/Anthropic formats and both MCP
protocol generations. It's AGPL-3.0 and runs as one Docker container. Feedback on false positives is gold to me!
