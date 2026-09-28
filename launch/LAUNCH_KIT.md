# ContractRift launch kit

Everything needed to get ContractRift in front of developers and engineering leaders. All claims below
are true for v0.3.0; do not add numbers (users, customers, benchmarks) that don't exist yet.

**Links to use everywhere**

- Repo: https://github.com/ahmedgcompany-cyber/contractrift
- Website: https://ahmedgcompany-cyber.github.io/contractrift/
- Live demo: `<your Render URL>` (after step 1 of YOUR_NEXT_STEPS.md) — demo login is shown on the sign-in page

## One-liners

- **Tagline:** Know when the APIs, LLMs and MCP servers you depend on go down — or silently change.
- **Short:** Open-source, self-hosted monitor that learns what your third-party APIs, LLM endpoints and MCP servers
  return, and alerts you when that contract breaks. Your API keys never leave your servers.
- **Positioning:** "Uptime monitors tell you it's up. ContractRift tells you it's still the same."

## Where to post, in order (one per day works better than all at once)

| Day     | Channel                                                | Why                                                              | File                    |
| ------- | ------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------- |
| 1       | **Hacker News — Show HN** (Tue–Thu, 8–10am US Eastern) | Biggest single source of developer + big-tech engineer attention | `posts/show-hn.md`      |
| 1       | **X / Twitter** thread + **LinkedIn** post             | LinkedIn reaches engineering managers at large companies         | `posts/social.md`       |
| 2       | **r/selfhosted**                                       | Exactly the audience that wants "keys stay home"                 | `posts/reddit.md`       |
| 3       | **r/devops**, **r/sre**                                | Monitoring / incident people                                     | `posts/reddit.md`       |
| 4       | **r/mcp**, **r/LocalLLaMA** (MCP + LLM angle only)     | AI builders                                                      | `posts/reddit.md`       |
| 5       | **dev.to / Hashnode / Medium** article                 | Long-lived search traffic                                        | `posts/article.md`      |
| 7       | **Product Hunt**                                       | Broad tech audience; schedule for 12:01am PT                     | `posts/product-hunt.md` |
| ongoing | GitHub topics, awesome lists                           | Discovery                                                        | see below               |

Rules that matter: post from your own account, reply to every comment within the first 2–3 hours, never ask for
upvotes (HN and Reddit penalise it), and follow each subreddit's self-promotion rules (read the sidebar first).

## Awesome lists (submit only when eligible)

| List                                                            | Requirement to check first                                                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| awesome-selfhosted (awesome-selfhosted/awesome-selfhosted-data) | Requires the project's **first release to be more than 4 months old** → submit after 2027-01-28 |
| awesome-monitoring, awesome-sre, awesome-api-devtools           | Read CONTRIBUTING of each; usually a one-line PR                                                |
| MCP tooling lists (e.g. "awesome-mcp-devtools")                 | ContractRift is an MCP _monitoring_ tool, not an MCP server — submit to dev-tools sections only |

## Reaching big tech companies (realistic path)

Cold-emailing "Google" does not work. What does:

1. **Engineers, not companies.** HN and LinkedIn reach engineers at large companies; they are the ones who star, try
   and later ask procurement for a commercial license.
2. **DevRel of the platforms you monitor.** Anthropic, OpenAI, Hugging Face and the MCP community care about
   MCP 2026-07-28 support. Share the MCP-specific post in their community forums/Discord (check rules) — not DMs.
3. **Conference CFPs:** submit the article topic ("Your tests mock the API. The API changed anyway.") to API/devtools
   conferences and local meetups.
4. **Commercial interest:** point people to COMMERCIAL_LICENSE.md (GitHub Discussion → private follow-up).
5. **Measure:** GitHub stars/traffic (Insights → Traffic), Docker pulls (Packages), demo logins (audit log).

## Social preview image

GitHub → Settings → General → Social preview → upload `assets/social-preview.png` (1280×640)
(GitHub has no API for this; it's a manual 30-second step).
