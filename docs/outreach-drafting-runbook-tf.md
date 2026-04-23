# Outreach Drafting — the TF runbook (reference)

This is Tristan's canonical instruction set for drafting cold-outreach
fundraising emails. Pasted verbatim from his 2026-04-23 Claude Code
prompt (run against `~/Documents/Kite Power`) so the forge-capital-app
drafter has it as reference material.

Tristan's framing: *"It's worth you having this and saving this
somewhere and also saving it into the app, not because it's the only
way of doing things (because things clearly will change), but it'll
give you a good idea."*

The app's Haiku drafter (`app/(authed)/templates/actions.ts`) does NOT
yet implement all of this. This file is the target state. Items not
yet wired into the app are flagged **[NOT WIRED]**.

## Required reading referenced by the TF prompt

Lives outside this repo in `~/Documents/Kite Power/`:

1. `CLAUDE.md` — project rules, source of truth.
2. `Outreach Writing Rules TF.md` — the 12 binding drafting rules.
3. `Outreach Drafting Runbook TF.md` — detailed how-to, company
   paragraph templates, verification checklist.
4. `260423 AB Drafts Batch v6 TF.md` — worked example of 56 drafts
   with all edge cases handled.

## Source of truth for recipient content

The Forge Capital **SQLite DB** at `~/.forge-capital/forge-capital.db`
(separate from the Supabase `kgkajatjyqfetdtbzmwg` that the app uses).
Specifically the `--- ENRICHMENT YYYY-MM-DD ---` block inside
`investors.notes`, reading the `why_fit_hint` field as the primary
seed for the Rule 1 hedged paragraph. Typed columns
(`thesis_summary`, `connection_brief`, `investment_pattern`,
`value_add`, `recent_activity`) are secondary support.

**Never substitute training knowledge for DB content.** If the DB is
silent on a firm, say so and ask — do not make up a thesis.

> The SQLite DB and the Supabase cluster are different data stores.
> The app's investor facts come from Supabase; the SQLite DB drives
> the Excel outreach batches. Keeping them aligned is a separate
> problem the app does not solve yet.

## Hard constraints for every draft

### Paragraph order (Rule 10)

1. **Salutation** — `Dear [First name],` by default;
   `Dear [Rank] [Surname],` if the first token is a rank (Admiral,
   Ambassador, Captain, General, etc.). Never `Dear Admiral,` bare.
2. **Bio** (Rule 3 verbatim, **Drax removed**).
3. **Company paragraph** (template from the Runbook).
4. **Hedged fund paragraph** (Rule 1 phrasing).
5. **FishFrom video link** — FishFrom campaign only, never SkySails
   or Panatere.
6. **20-min ask** with 3–5 specific calendar slots.
7. **Sign-off** with LinkedIn URL (Rule 12).

### Subject lines (Rule 2)

- Unique per recipient.
- Prefix identifier + a per-firm angle in parens pulled from
  `why_fit_hint` / `sector_tags`.

### Voice (Rule 11)

- **Never congratulate or flatter.**
- Banned tokens: `congratulations`, `great to see`, `loved your`,
  `enjoyed your`, `impressive work`, `excited to see`.
- The only permitted personal hook is a factually-verifiable one
  (shared prior firm, named prior investor in one of Tristan's
  businesses, mutual contact).

### Campaign-specific facts the drafter MUST use

- **Panatere** emails must NOT name a CEO. Tristan's counterpart is
  **Andreas Cser at Fraser Finance**, not a Panatere employee.
- **FishFrom** is co-founded by **Andrew Robertson**; reference
  **Swansea University trials** and **Finnforel beta site in
  Finland**. Do NOT say Cambridge.
- **SkySails** is raising a **€5M Series A bridge**, with **Kembara**
  (one of Europe's largest deep-tech and climate growth funds)
  committed to lead a **€25M Series B at milestones**. Include this
  signal in SkySails drafts. Use "the global leader in airborne wind
  energy, with the only commercially operational energy kite system
  in the world" framing.

### Low-confidence rows

Add the sentence: *"If I have misread the fit here, I would welcome
the correction."*

## Required pre-send cross-checks (Runbook Section 11)

1. **Gmail history**: `from:<email> OR to:<email>` — flag any prior
   thread. **[NOT WIRED]** (the app now does inbound ingestion but
   does not yet surface a pre-send thread check).
2. **Master Investor Tracker** (`260416 Master Investor Tracker
   TF.xlsx`, `Master Tracker` sheet): read status in the target
   workstream AND in the other two. Flag anything ≥ `+3 Email sent`.
   **[NOT WIRED]** — the app has tracker status but does not surface
   cross-workstream status on the draft page.
3. If prior same-person contact exists on a different workstream,
   open with: *"I wrote to you recently about [other workstream]..."*
   — do NOT send a second fresh first-contact.
4. If any partner at the firm is already at `+6.5 Handover to
   company`, exclude the row — route through the existing
   counterpart.
5. If the only known email is a generic inbox (`info@`, `contact@`,
   etc.) — defer until a better contact is found. **[WIRED]** — the
   app already tiers emails and blocks the Send button for
   `generic_blocked`.

## Required post-generation verification (Runbook Section 12)

Every outbound batch MUST pass these checks before Gmail drafts are
created:

- **"Drax"** does not appear in any body.
- LinkedIn URL `https://www.linkedin.com/in/tristanfischer/` in every
  sign-off.
- Bio phrase **"twenty-five years"** in every body.
- At least one Rule 1 hedge phrase in every body
  (`"My understanding is that..."` / `"I am reaching out because..."`).
- FishFrom video URL in every FishFrom body and zero non-FishFrom
  bodies.
- `"20 minutes"` + specific slot list in every body.
- All subject lines unique.
- No flattery tokens (see banned list above).
- SkySails drafts contain `"Kembara"` AND `"€5M Series A bridge"`.
- Salutations: no bare-rank forms (`"Dear Admiral,"` /
  `"Dear Ambassador,"` / `"Dear Captain,"`).
- No "Panatere CEO" / named CEO in Panatere paragraphs.
- No "Cambridge" in FishFrom paragraphs.

## Deliverables per batch

1. `YYMMDD <descriptor> TF.xlsx` with columns `#`, `Workstream`,
   `Firm`, `Tier`, `Confidence`, `Recipient`, `Email`, `Subject`,
   `Body`, `Tracker row`, `Note`. Colour-code by workstream and
   confidence. Include a Summary tab with totals, excluded rows,
   low-confidence flags.
2. `YYMMDD <descriptor> TF.md` with the same drafts one-per-section
   for quick review.

**Do NOT create Gmail drafts until Tristan approves the batch.**
Send in sub-batches of 10–15 so he can tweak-and-send. The app's
Send-via-Gmail button mirrors this — it requires an explicit confirm
before dispatching.

## Calendar slots for the ask

Pull real free 30-minute weekday windows from Tristan's primary
Google Calendar in BST (Europe/London) over the next 10 working days
using the `suggest_time` tool with `attendeeEmails=['primary']`.
Offer 3–5 options spread across mornings / afternoons, shown with
UTC and CET offsets. **[NOT WIRED]** — the app's draft composer
currently emits a generic "Would you have 20 minutes for a brief
call? I am available early next week." line via `buildCtaBlock` in
`app/(authed)/tracker/[campaignPartnerId]/draft/compose.ts`.

## Stop-and-ask guardrail

> *"Errors of the form 'Andreas Carmichael is Panatere's CEO' (he
> isn't) and 'FishFrom is Cambridge-rooted' (it isn't) have happened
> before because a drafter substituted memory for source. The cost
> of asking is zero; the cost of a wrong fact in a cold email to an
> investor is significant."*

When the drafter (human or Haiku) lacks a fact, it stops and asks.
It does NOT invent. It does NOT emit bracketed placeholders either
(banned since 2026-04-23 after brackets shipped to a real recipient).

## What the forge-capital-app drafter currently does vs this spec

| Rule | App state (2026-04-23) |
|---|---|
| Paragraph order | Implements credibility → company → synthesis → CTA — matches 2/3/4. Missing: salutation logic for ranks, FishFrom video link injection. |
| Subject uniqueness | Subject currently derived from `campaigns.company_description` — same for every recipient in a campaign. **[GAP]** |
| Voice | Haiku prompt now forbids brackets, uses `founder_bio` + `voice_reference_email` as few-shot. Does NOT yet forbid the six flattery tokens in the anti-pattern list. **[GAP]** |
| Drax removal | `founder_bio` in Supabase edited 2026-04-23 to remove Drax — **[WIRED via data]**, not yet a lint check. |
| Campaign-specific facts | `campaigns.company_description` holds the live narrative (SkySails €5M / Kembara signal is in the row; the app uses it). Panatere / FishFrom / SkySails speciality rules would need drafter-side lints. **[PARTIAL]** |
| Low-confidence safety sentence | Not yet auto-appended. **[GAP]** |
| Pre-send Gmail history check | **[NOT WIRED]** |
| Pre-send cross-workstream status | **[NOT WIRED]** |
| Generic-inbox block | **[WIRED]** (email_tier = generic_blocked → Send disabled). |
| Post-gen verification checklist | **[NOT WIRED]** as a lint pass; Tristan currently eye-balls every send. |
| Calendar slot injection | **[NOT WIRED]** — `buildCtaBlock` emits a generic line. |

Follow-up tasks to close these gaps live in `BACKLOG.md` / the task
tracker.

---

*Canonical source: Tristan's `~/Documents/Kite Power/` working
directory. This file is a mirror for the app's reference — it falls
out of date every time the spec evolves. Treat Tristan's source as
authoritative; treat this file as a prompt for "what would the
drafter need to change to honour the current rules?"*
