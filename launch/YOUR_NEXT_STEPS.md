# Your next steps (baby steps)

These are the only things that need **you** — they require your own accounts, payment details or identity.
Everything else is done. After each step, tell Claude "step N done" and it continues.

---

## Step 1 — Create your admin account on the live demo · 2 minutes

The server is already running for free on Google Cloud: **https://136-119-147-140.sslip.io**

1. Open `C:\Users\AHMED\projects\tripline\.deploy\gcp-secrets.env` in Notepad and copy the value after `SETUP_TOKEN=`.
   (That file never goes to GitHub. Keep `ENCRYPTION_KEY` from it in your password manager.)
2. Open https://136-119-147-140.sslip.io/setup
3. Paste the setup token, enter your name, email and a strong password, then click **Create account**.
   This is your private admin login. Visitors use the read-only demo account shown on the sign-in page.

Cost: $0 within Google's free tier. A budget alert emails you at $1, $2.50 and $5 in case traffic goes above the free
1 GB/month. The server lives in your Google Cloud project `project-7fdbf92c-b2dd-4109-bc3` (VM name `contractrift`).
Do **not** stop/start the VM from the console (the IP, and therefore the address, could change); use "Reset" if needed.

(Paid alternative with managed PostgreSQL: Render, see DEPLOYMENT.md.)

---

## Step 2 — Test with OpenAI and Anthropic (optional, < 1 cent) · 5 minutes

1. OpenAI: https://platform.openai.com/api-keys → **Create new secret key** → copy it.
2. Anthropic: https://console.anthropic.com/settings/keys → **Create Key** → copy it.
3. Open `C:\Users\AHMED\projects\tripline\.env` in Notepad, add two lines, save:
   ```
   LIVE_OPENAI_API_KEY=sk-...
   LIVE_ANTHROPIC_API_KEY=sk-ant-...
   ```
   **Never paste keys into the chat.** `.env` is ignored by git.
4. Tell Claude "keys added".

---

## Step 3 — Upload the social preview image · 1 minute

GitHub has no API for this.

1. Open https://github.com/ahmedgcompany-cyber/contractrift/settings
2. **Social preview** → **Edit** → **Upload an image** → choose
   `C:\Users\AHMED\projects\tripline\assets\social-preview.png`.

---

## Step 4 — Docker image visibility · nothing to do

Verified 2026-09-28: the image is already publicly pullable. Only if that ever changes:

If `docker pull ghcr.io/ahmedgcompany-cyber/contractrift` says "unauthorized":

1. Open https://github.com/users/ahmedgcompany-cyber/packages/container/package/contractrift
2. **Package settings** → **Danger Zone** → **Change visibility** → **Public** → type `contractrift` → confirm.

---

## Step 5 — Launch (posting must come from your own accounts)

Follow `launch/LAUNCH_KIT.md`. Texts are ready in `launch/posts/`. Order:

1. Hacker News: create an account at https://news.ycombinator.com (new accounts can post Show HN).
   Submit → paste title + repo URL from `posts/show-hn.md` → then immediately add the first comment.
   Best time: Tuesday–Thursday, 8–10 am US Eastern (4–6 pm UAE time).
2. Same day: LinkedIn + X posts from `posts/social.md` with the screenshots attached.
3. Next days: Reddit posts (one subreddit per day), then the article, then Product Hunt.
4. Stay online for 2–3 hours after each post and answer every comment.

---

## Before selling (later)

- Trademark search for "ContractRift" in your country/target markets (e.g. USPTO, EUIPO, WIPO Global Brand Database).
- Register the domain.
- A lawyer-reviewed commercial license agreement template (COMMERCIAL_LICENSE.md explains the model; the contract itself needs a lawyer).
