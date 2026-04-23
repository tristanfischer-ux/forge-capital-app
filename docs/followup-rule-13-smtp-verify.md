# Follow-up — Rule 13 full compliance (SMTP deliverability probe)

Kite Power CLAUDE.md codified Rule 13 on 2026-04-23 after a v6 batch
produced a **29% bounce rate (9 of 31)** because pattern-synthesised
addresses (`email_verified = 0`, source `guessed` /
`hunter_finder_first`) had never been MX-confirmed.

## Current state in this repo

`lib/email/check-mx.ts` runs a DNS probe:
- `dns.resolveMx(domain)` — has MX records?
- `dns.resolve4(domain)` — has A records as fallback?

That's DNS deliverability. **It is not Rule 13 compliant.** Rule 13
requires a real SMTP/MX probe (or an equivalent service — Hunter,
NeverBounce, Apollo) that exercises the mail server, not just that
DNS resolves. A domain can have MX records AND still reject specific
mailboxes.

## What would close the gap

**Option A — Hunter.io verifier API.** We already have a Hunter key
wired for the nightly pipeline's `email_tier` column on
`partners_mirror`. A send-time call to `/v2/email-verifier` costs one
credit per recipient; returns `status: deliverable / risky / invalid
/ unknown` with confidence scores.

**Option B — NeverBounce.** Same shape; different provider.

**Option C — Raw SMTP probe.** `net.createConnection` to the MX host
on port 25, `HELO / MAIL FROM / RCPT TO <target>`. Many domains
greylist (return 250 for everything) making this unreliable at the
individual-mailbox level; best used with (a) as a secondary signal.

## Recommended build order

1. `lib/email/verify-deliverability.ts` — wraps Hunter API. Returns
   `{deliverable: bool, reason, provider: 'hunter'}`.
2. Replace `checkMx(email)` call in `sendGmailMessage` with
   `verifyDeliverability(email)`.
3. Cache result on `partners_mirror.email_verified_at` + refresh if
   older than 30 days (contact data decays).
4. Batch path: `/approval/test-send` gets a pre-flight step that
   verifies all 20 recipient addresses BEFORE any send dispatches.
   If < 100% pass, show the list of failing rows and let Tristan
   decide to proceed (skipping bad), stop, or hunt for replacements.
5. Rule 13's post-send step: write `email_verified=1` +
   `email_verified_at = now()` on success; demote to `email_previous`
   on failure.

Est 2-3 hours. Hunter API calls are rate-limited so the batch pre-
flight needs to respect that (their rate limit is ~15 req/sec, fine
for 20-row batches).

## Not yet built — tracking here so it's not forgotten

`MX check` is necessary but not sufficient. A 29% bounce rate with
Hunter-verified data on a fresh batch would still be bad; with Rule
13 strictly applied (SMTP probe per recipient, exclude anything not
`valid`), the target is <2% bounce.
