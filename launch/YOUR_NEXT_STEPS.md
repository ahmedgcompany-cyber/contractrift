# Your next steps (baby steps)

These are the only things that need **you** — they require your own accounts, payment details or identity.
Everything else is done. After each step, tell Claude "step N done" and it continues.

---

## Step 1 — Put the live demo online (Render, ≈ $13/month) · 10 minutes

1. Go to https://render.com and click **Get Started** → **Sign in with GitHub** (use your `ahmedgcompany-cyber` account).
2. Allow Render to access the **contractrift** repository when GitHub asks.
3. Render → top-right avatar → **Billing** → add a payment card. (Needed: the free plan sleeps and would stop monitoring.)
4. Open this link: https://render.com/deploy?repo=https://github.com/ahmedgcompany-cyber/contractrift
5. Render shows "contractrift" (web service) and "contractrift-db" (database).
   For **DEMO_MODE** type: `true`
6. Click **Deploy Blueprint**. Wait until the service shows **Live** (5–10 minutes).
7. Click the **contractrift** service → **Environment** → reveal **SETUP_TOKEN** → copy it.
   Also copy **ENCRYPTION_KEY** into a password manager (you need it to restore backups).
8. Click the service URL at the top (looks like `https://contractrift-xxxx.onrender.com`).
   Enter the setup token, your name, email and a strong password → **Create account**. This is YOUR admin login.
9. Tell Claude the URL. Claude adds it to the README, website and launch posts.

(You don't need a domain now. Later: buy `contractrift.com` or `contractrift.dev` — both were unregistered on
2026-09-28 — at any registrar, then Render → Settings → Custom Domains.)

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
   `C:\Users\AHMED\projects\tripline\assets\screenshots\dashboard-light.png`.

---

## Step 4 — Make the Docker image public (if needed) · 1 minute

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
