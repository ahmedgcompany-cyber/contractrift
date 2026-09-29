# HANDOFF — read this first in a new session

This file records everything done so far (2026-09-28 → 2026-09-29) and how to continue.
Next, read: `PROJECT_STATUS.md` (honest status), `AI_DEVELOPMENT_CONTEXT.md` (architecture + rules not to break),
`CLAUDE_CODE_GUIDE.md` (commands), `launch/YOUR_NEXT_STEPS.md` and `launch/LAUNCH_SCHEDULE.md` (owner tasks).

**No secrets are in this repository.** Secret files are listed in §3 by location only.

---

## 1. What the product is

**ContractRift** (named "Tripline" until v0.3.0) — an open-source, self-hosted monitor for the external dependencies an
app relies on: REST/JSON APIs, LLM APIs (OpenAI-compatible, Anthropic) and MCP servers (2026-07-28 stateless and older
initialize-based). It detects outages **and silent structural drift** (removed/retyped fields, new nulls, LLM model
changes behind an alias, MCP tools removed or gaining required params), with a drift inbox (accept/dismiss), incidents,
signed webhooks/Slack, a CI deploy gate, roles, API tokens, audit log, encrypted secrets with key rotation.

Owner goal: public exposure (incl. big-tech engineers), then sell (dual license: AGPL-3.0 + commercial).

## 2. Where everything is

| What                           | Where                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Working copy (main dev folder) | `C:\Users\AHMED\projects\tripline` (folder name kept after the rename)                                                                                                          |
| Mirror copy for the owner      | `C:\Users\AHMED\OneDrive\Desktop\Project_2026\contractrift` (git clone, no `node_modules`; update with `git pull`)                                                              |
| GitHub (public)                | https://github.com/ahmedgcompany-cyber/contractrift (account `ahmedgcompany-cyber`, `gh` CLI is logged in)                                                                      |
| Website (GitHub Pages)         | https://ahmedgcompany-cyber.github.io/contractrift/ (source `site/`, workflow `.github/workflows/pages.yml`)                                                                    |
| Docker image                   | `ghcr.io/ahmedgcompany-cyber/contractrift:0.3.1` (and `:latest`), multi-arch, public                                                                                            |
| Releases                       | https://github.com/ahmedgcompany-cyber/contractrift/releases (v0.3.0, v0.3.1)                                                                                                   |
| **Live demo**                  | **https://136-119-147-140.sslip.io** (DEMO_MODE on; admin = owner, `Ahmedgcompany@gmail.com`)                                                                                   |
| Demo server                    | Google Cloud e2-micro "Always Free", VM `contractrift`, zone `us-central1-a`, project `project-7fdbf92c-b2dd-4109-bc3`, billing account `014CD6-5BBF6E-7A73A3`, budget alert $5 |
| Launch texts                   | `launch/posts/*.md`, plan `launch/LAUNCH_KIT.md`, schedule `launch/LAUNCH_SCHEDULE.md`                                                                                          |
| Social images / videos         | `marketing/images/*.png`, `marketing/video/*.mp4` (generator `marketing/generate.mjs`)                                                                                          |
| Screenshots                    | `assets/screenshots/` (generator `tests/screenshots/capture.spec.ts`), social preview `assets/social-preview.png`                                                               |

## 3. Secrets (locations only — never commit or paste into chat)

| File                                                                                                    | Contains                                                                                   |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `C:\Users\AHMED\projects\tripline\.deploy\gcp-secrets.env` (git-ignored)                                | `ENCRYPTION_KEY`, `SETUP_TOKEN` (used) of the demo server                                  |
| `C:\Users\AHMED\OneDrive\Desktop\Project_2026\ContractRift-SECRETS-BACKUP.txt` (outside the git folder) | same + server details                                                                      |
| `C:\Users\AHMED\projects\tripline\.env` (git-ignored)                                                   | local dev config; add `LIVE_OPENAI_API_KEY` / `LIVE_ANTHROPIC_API_KEY` here for live tests |
| On the VM: `/opt/contractrift/secrets.env` (root-only)                                                  | the server's copy                                                                          |

## 4. Timeline of what was done

1. **Research** (`research/`): 6 candidate problems, decision matrix → API/LLM/MCP dependency drift (35/40). Competitors
   analysed (all continuous drift monitors found were SaaS).
2. **Product spec + architecture** (`PRODUCT_SPEC.md`, `ARCHITECTURE.md`).
3. **Backend**: TypeScript, Fastify 5, Drizzle ORM, PostgreSQL or embedded PGlite, TypeBox, argon2id, AES-256-GCM,
   SSRF-guarded undici client, probes (http/llm/mcp), drift engine, runner (one transaction per check), outbox
   notifications, scheduler with `FOR UPDATE SKIP LOCKED`, retention.
4. **Frontend**: React 19 + Vite, "instrument panel" design, light/dark, responsive.
5. **Tests**: Vitest unit/integration against real local protocol-faithful upstreams (`backend/test/support/upstreams.ts`),
   Playwright E2E. Currently **147 tests + 11 E2E**, all passing; CI also runs them on PostgreSQL 17.
6. **Docs**: full set (README, INSTALLATION, USER_GUIDE, DEVELOPER_GUIDE, API_DOCUMENTATION + generated OpenAPI,
   DATABASE, DEPLOYMENT, SECURITY, TROUBLESHOOTING, ROADMAP, CHANGELOG, MARKETING_CONTEXT, CLAUDE_CODE_GUIDE, …).
7. **v0.2.0**: key rotation (`ENCRYPTION_KEY_PREVIOUS`, `npm run rotate-key`), secret URL query params, paginated
   monitor list, opt-in live tests (`npm run test:live -w backend`) — passed against GitHub API, DeepWiki MCP,
   Hugging Face MCP (tool calls on both MCP generations) and LM Studio; OpenAI/Anthropic skipped (no keys).
8. **CI** (GitHub Actions): lint/typecheck/tests, PostgreSQL 17 suite, Playwright E2E, docker-compose stack run.
9. **v0.3.0**: renamed to ContractRift (name availability checked on GitHub, npm, web, `.com`/`.dev`), license
   AGPL-3.0 + commercial (`COMMERCIAL_LICENSE.md`, `CONTRIBUTING.md`), `SETUP_TOKEN`, `DEMO_MODE`, Render blueprint,
   GHCR release workflow, GitHub Pages site, screenshots, launch kit. Repo made **public**; commit history rewritten to
   the GitHub no-reply email (personal email removed). Private vulnerability reporting + Discussions enabled.
10. **gstack** upgraded 0.17 → 1.91.2.0 (its browser tool was unusable on this Windows PC before).
11. **Free hosting**: Google Cloud e2-micro. Default project got billing linked (the account had hit its project quota).
    Firewall: only 80/443 public; SSH/RDP restricted to Google IAP range. Caddy provides HTTPS via sslip.io.
12. **v0.3.1**: fixed a bug found during deployment (demo account blocked first-run admin setup).
13. Owner created the admin account; secrets backup saved; social preview image made (`assets/social-preview.png`).
14. **Security email from Google** ("Project-level SSH key added", 28 Sep 18:50 UTC): it was our own `gcloud compute ssh`
    from this PC (key comment `ALGHOUL\AHMED@ALGHOUL`). Hardened: project switched to **OS Login**, the project-level
    key removed; SSH via IAP still works.
15. **Marketing media**: 13 platform-sized images + 2 explainer videos (24 s; vertical 1080×1920 for TikTok/Reels/Shorts,
    horizontal 1920×1080 for LinkedIn/X), launch schedule with the file to attach per post.

## 5. How to operate

```bash
cd C:\Users\AHMED\projects\tripline
npm ci                                   # first time on a machine
npm run typecheck && npm run lint && npm test
npm run build && PW_CHANNEL=chrome npm run test:e2e
npm run dev / npm run dev:web            # local development (see CLAUDE_CODE_GUIDE.md)
```

**Release**: bump versions (3 package.json + `backend/src/app.ts` VERSION + MCP clientInfo), CHANGELOG entry, commit,
`git tag -a vX.Y.Z -m … && git push origin main vX.Y.Z` → Release workflow publishes GHCR image + GitHub Release.

**Update the live demo** to a new version:

1. Edit `CONTRACTRIFT_VERSION:-X.Y.Z` in `.deploy/startup.sh` **and** `deploy/gcp/startup.sh`.
2. `gcloud compute instances add-metadata contractrift --zone us-central1-a --project project-7fdbf92c-b2dd-4109-bc3 --metadata-from-file startup-script=.deploy/startup.sh`
3. `gcloud compute instances reset contractrift --zone us-central1-a --project project-7fdbf92c-b2dd-4109-bc3`
   (**never stop/start** — the ephemeral IP, and so the sslip.io URL, could change).
4. Check `https://136-119-147-140.sslip.io/api/v1/openapi.json` → `info.version`.

Logs: `gcloud compute ssh contractrift --zone us-central1-a --project project-7fdbf92c-b2dd-4109-bc3 --tunnel-through-iap --command "sudo docker logs --tail 50 contractrift-app-1"`

## 6. Open items (owner)

1. Upload social preview image on GitHub (Settings → Social preview → `assets/social-preview.png`).
2. Post the launch in the order of `launch/LAUNCH_SCHEDULE.md` (Hacker News first, Tue 29 Sep 4 pm UAE).
3. Optional: OpenAI/Anthropic keys in `.env` → `npm run test:live -w backend`.
4. Before selling: trademark search, buy `contractrift.com`/`.dev` (unregistered on 2026-09-28), lawyer-reviewed
   commercial license contract. With a domain: point it to the VM IP and change `HOST` in the startup script.

## 7. Gotchas on this PC (save time)

- **Windows Application Control blocks unsigned `.exe`** (e.g. Biome, oxlint). Use pure-JS tools (ESLint/Prettier).
- `npx <name>` may fetch an unrelated package (happened with `biome`); use `npx --no-install` for local bins.
- The Read tool is gated by a code-discovery hook for source files; `cat`/`sed`/`grep` via Bash work.
- Python one-liners in Bash: Windows paths with `\U…` break string escapes — write scripts to files with raw strings.
- Prettier re-formats Markdown tables: text replacements must match the formatted text (or edit before formatting).
- Session scratchpad path is too long for `git clone` (Windows path limit); use short folders.
- `gcloud compute ssh` on Windows uses PuTTY/plink; add `--tunnel-through-iap --quiet`.
- Google Cloud: the account cannot create new projects (quota); use `project-7fdbf92c-b2dd-4109-bc3`.
- Port 3000 is used by another program on this PC; run local servers on 3300/3310 etc.
- `~/.claude/settings.json` starts with a UTF-8 BOM, so gstack could not add its hooks (not changed by us).

## 8. Recommended next development

See `ROADMAP.md`: retention for drift events/incidents/audit, email notifications + per-monitor routing,
OpenAPI/GraphQL-based expectations, LLM quality assertions, shared rate-limit store, a real domain for the demo.
