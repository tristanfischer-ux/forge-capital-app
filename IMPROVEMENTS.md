# IMPROVEMENTS.md — streamline ideas surfaced by the Wren walkthrough

Tagged [BLOCKER] / [VALUE] / [NICE].


## DAY 0

- [VALUE] **No new-campaign UI in the app**. Today campaigns must be inserted via SQL or the pipeline. A founder onboarding flow at `/campaigns/new` (with the 6 fields: name, intent, description, raise_size, website, counterpart) would be a real win — it's the first thing a new user would expect.
- [NICE] **Section-title consistency**: Find-a-Match uses `.hero-title`, every other section uses `.section-title`. Either rename or add a small wrapping `.section-title` for nav/screenshot consistency.


## DAY 1

- [BLOCKER → fixed migration 019] HNSW ef_search default of 40 was capping every match query. The default scorer/Find-a-Match were producing 4-row results when the DB had 705 sector-relevant investors. Fixed.
- [VALUE] **No "no matches found" empty state with diagnostics**. When the result set was 4, the UI showed 4 cards with no signal that something might be wrong. A "Showing 4 of 1,000 scored — broaden criteria?" honest empty/thin-state would have surfaced the bug from the user side.

## DAY 5

- [BLOCKER → fixed in this commit] `partner_email_overrides` weren't read by `lib/queries/investorModal.ts`. Any partner whose email was resolved via the EmailHuntModal would still appear as "no email on file" on the draft page → user couldn't proceed. Three places now read overrides; need an audit of every partner-email read path so this isn't whack-a-mole.
- [VALUE] **Templates: brand-new campaign should auto-seed Haiku-drafted defaults** instead of rendering 3 missing-paragraph warnings on the very first draft. Today the founder must manually visit /templates and click "Draft with Haiku" 3 times before they can compose a single email. One-click "Set up templates for this campaign" on the draft page when the templates row is missing.
- [NICE] **Email override didn't show provenance on the draft page**. Once override fix lands, render a tiny "(via override)" or similar so the user knows this isn't the pipeline's verified email — small but useful trust signal.


## DAY 6-8

- [VALUE] **No "send via app" button** — Gmail draft is created, but actually sending requires the user to leave the app, find the draft in Gmail, click send. Add a "Send draft now" button on /tracker/[id]/draft that calls `gmail.users.messages.send` (the existing gmail.compose scope already includes send capability — verified live during the audit).
- [NICE] **Placeholder text in `partner_email_hunt_requests` queue UI** — pipeline page shows "1 partner queued for Hunter" but doesn't say WHICH or for which campaign. Add a click-through to a queue list.
- [VALUE] **Cron-cascade dashboard at /pipeline doesn't show overnight outcomes vs expected** — "Latest 38h ago" for Gmail sync is a confusing relative time when the cron runs every 15min. Show "next run: in 7 min" alongside "last run: 38h ago" and you can see at a glance whether there's drift.
