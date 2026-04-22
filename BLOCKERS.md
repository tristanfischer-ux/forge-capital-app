# BLOCKERS.md — things waiting on Tristan

Parked items that can only be completed by Tristan in person (or with
a browser that has Google-approved 2FA access). Everything in this
file is polish — the app is fully functional without any of them.

---

## 1. Gmail OAuth client — enables one-click "Create Gmail draft"

**Why it's deferred:** OAuth 2.0 client creation is web-UI-only
(Google shut down the programmatic path, March 2026). Your Google
account enforces passkey 2FA, which needs physical Touch ID / YubiKey
access — not reachable over remote-login.

**When to do it:** Any 3-minute window when you're physically at the
Mac. Does not need to be soon. Existing clipboard-copy + weekly file
output give the same effective workflow.

**Steps (~3 min in person):**

1. Open <https://console.cloud.google.com/apis/credentials/consent?project=fractional-6a765>

   If the consent screen isn't configured, configure it:
   - User Type: External
   - App name: `Forge Capital`
   - User support email + Developer contact: `tristan.fischer@gmail.com`
   - Authorised domains → ADD DOMAIN: `vercel.app`
   - Scopes → ADD OR REMOVE SCOPES → filter `gmail.compose` → tick → UPDATE
   - Test users → ADD: `tristan.fischer@gmail.com`
   - Save and continue through each step.

2. Open <https://console.cloud.google.com/apis/credentials?project=fractional-6a765>
   - Click **+ CREATE CREDENTIALS → OAuth client ID**
   - Application type: **Web application**
   - Name: `Forge Capital — Gmail drafts`
   - Authorised redirect URIs — ADD both:
     - `https://forge-capital-app.vercel.app/api/auth/gmail/callback`
     - `http://localhost:3000/api/auth/gmail/callback`
   - Click **Create**

3. Copy the **Client ID** and **Client secret** from the popup.

4. Paste both to me in a new chat and I handle:
   - `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI` into
     Vercel (prod + preview + dev) + `.env.local`
   - Prod redeploy
   - Walk you through connecting Gmail once via `/api/auth/gmail` to
     mint the refresh token into `gmail_tokens`
   - Smoke-test the Create-Gmail-Draft button on a tracker draft page
   - Smoke-test the weekly composer switching from file-output to
     Gmail drafts mode

Total wall-clock after paste-back: ~2 minutes.

---

## 2. Fischer Farms Customer first-contact template

**Why it's deferred:** The customer-outreach programme starts July
2026. No sends exist in Gmail yet, so there's nothing canonical to
transcribe into `email_templates`.

**When to do it:** After your first real Fischer Farms send. Ping me
in chat, paste the Gmail thread, I transcribe it into
`email_templates` + `seed/templates.json` matching the Panatere /
ForgeOS pattern from commit `c2bfaf0`.

---

## 3. Approver-specific UI (Phase 5.1)

**Why it's deferred:** RLS scopes Stephan/Andrew/Olivier correctly
already (migration 011). When they log in, they see their one
assigned campaign; other sections render empty. Functional but not
tailored.

**When to decide:** When you want to invite them. Design options:
  a. Leave as-is — they see their campaign only, other sections look empty
  b. Build an "approver inbox" screen — single-page view of their
     pending approvals, no other sections
  c. Per-role home page via role-based routing

Needs your steer — not autonomous. Ping me with a preference and I
build it.

---

## 4. Seeding real approver emails

**Why it's deferred:** Placeholder stubs are in `seed/approvers.sql`.
Need you to confirm the real email addresses of Stephan, Andrew,
Chris Kirke, Olivier before uncommenting and running.

**When to do it:** Whenever you're ready to give them access. SQL
paste into <https://supabase.com/dashboard/project/kgkajatjyqfetdtbzmwg/sql/new>.

---

Last updated: 2026-04-22
