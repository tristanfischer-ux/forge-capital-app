# Outreach Drafting Runbook — Tristan Fischer campaign

> **Provenance.** Pasted verbatim from Tristan on 2026-04-23. The
> canonical source lives in `~/Documents/Kite Power/Outreach
> Drafting Runbook TF.md`. This repo copy is a mirror — if Tristan's
> source has been updated since, prefer it.
>
> Companion: `docs/outreach-drafting-prompt-tf.md` (the short-form
> "paste at start of session" prompt).
> Companion: `docs/voice-reference-skysails-quantonation.md` (the
> canonical voice sample for Haiku few-shots).

**Purpose.** This document is a self-contained brief for a Claude (or any drafter) picking up a batch of cold-outreach emails for Tristan Fischer's fundraising workstreams. It codifies the rules, templates, cross-checks and style patterns that are in active use as of 2026-04-23. Read it end-to-end before drafting.

Canonical source of the rules is `~/Documents/Kite Power/Outreach Writing Rules TF.md` and `~/Documents/Kite Power/CLAUDE.md`. If those files have been updated since this runbook, prefer them.

---

## 1. Context — what Tristan is raising

Tristan stepped down as CEO of Fischer Farms earlier in 2026 and is now helping three companies raise capital:

- **SkySails Power** — CEO/Founder Stephan Wrage. Airborne wind energy. Global leader, only commercially operational energy kite system in the world. Large automated tethered kites flying figure-of-eight patterns at altitudes above conventional turbines, generating electricity by pulling on a ground-based generator. Commercial pilots running, production-capable facility in Hamburg. Raising a **€5M Series A bridge**, with **Kembara** (one of Europe's largest deep-tech and climate growth funds) indicating a €25M Series B lead once bridge milestones are met.
- **Panatere** — Swiss circular metals / watchmaking materials. Short-loop recycling of precision-grade steel and specialty alloys used in Swiss watchmaking and precision manufacturing. Sits at the centre of a luxury supply chain proving provenance and circularity. Patent portfolio. Swiss Series A. **Tristan's counterpart is Andreas Cser at Fraser Finance (`acser@fraserfinance.com`), who is leading the fundraise on the company side — Tristan does not deal with Panatere directly.** Do not name a Panatere CEO in any outreach.
- **FishFrom Technologies** — co-founded by Andrew Robertson, with commercial trials at Swansea University and a Finnforel beta site in Finland. Photocatalytic ozonation water-treatment system for land-based aquaculture. Closed £500K EIS seed + ~£473K Scottish Enterprise grant. Opening a bridge round ahead of first full-scale farm deployment.

A secondary workstream, **ForgeOS**, exists with its own tracker — not usually part of the cold-outreach drafting batches unless explicitly scoped.

---

## 2. Source-of-truth data — where to pull from

- **xlsx trackers** — per-workstream, in `~/Documents/Kite Power/` with filenames like `YYMMDD <workstream> Outreach — Call with <counterpart> TF.xlsx`. Canonical fields: `Investor`, `Contact`, `Sector`, `Investor Contact Status`, `Initial Contact Date`, `Last Contact Date`, `Days Since Contact`, `Status Update`, `Comment <counterpart>`.
- **Master Investor Tracker** — `260416 Master Investor Tracker TF.xlsx`. One row per firm with workstream-specific status columns for SkySails (cols 5–9), FishFrom (cols 10–14), Panatere (cols 15–19). Cross-workstream view.
- **Forge Capital DB** — `~/.forge-capital/forge-capital.db` (SQLite). Tables `investors` and `investor_partners`. Partner-level emails, titles, verification flags. Firm-level thesis content is in `thesis_summary`, `thesis_deep`, `sector_focus`, `sector_canonical`, `stage_focus`, `cheque_min_usd`/`cheque_max_usd`, `geo_focus`, `value_add`, `recent_activity`, `investment_pattern`, `team_expertise`, `connection_brief`. A drafter-facing enrichment block lives in `notes` under the `--- ENRICHMENT YYYY-MM-DD ---` delimiter, with a `why_fit_hint` field that is the primary seed for the Rule 1 hedged paragraph.

SQL file convention: when updating the DB, produce a re-runnable migration at `~/Documents/Kite Power/forge-capital-<topic>-YYYY-MM-DD.sql`. Apply with `sqlite3 ~/.forge-capital/forge-capital.db < file.sql` — note that zsh requires `$HOME` (not `~`) inside double-quoted paths.

---

## 3. Status taxonomy (Rule 8)

Monotonic positive scale for progress, separate negative bucket for terminations:

`+12 Committed` → `+11 Term sheet` → `+10 NDA / diligence` → `+9 Meeting held` → `+8 Meeting scheduled` → `+7 Meeting offered` → `+6.5 Handover to company` → `+6 Response received` → `+5 Follow-up sent` → `+4 Auto-reply / OOO` → `+3 Email sent` → `+2 Drafted — ready to send` → `+1 Approved — awaiting draft` → `+0 Pending approval`

- **`+6.5 Handover to company`** is Tristan's terminal state — once the dialogue is warm enough to pass to the CEO (Stephan / Andreas / Andrew), Tristan stops driving.
- `-1 Declined` / `-2 Bounced` / `-3 Disqualified`.

Commentary column uses ` | ` as separator, newest entry at the end, each entry prefixed with the date in `YYYY-MM-DD` form.

---

## 4. Recipient classification tiers (A–F)

When approaching a new batch, classify each approved-not-sent firm against the DB to decide which to draft immediately vs research first:

| Tier | Meaning | Action |
|---|---|---|
| **A** | Named tracker contact, email verified in DB | Draft now |
| **B** | Named tracker contact, email non-generic but unverified in DB (or tracker-only source) | Draft now, confidence flag |
| **C** | Tracker-named person not in DB, but a different partner at the firm is verified | Decision: swap to alt partner or research tracker contact |
| **D** | Tracker-named person not in DB, alt partner unverified | Decision |
| **E** | Only a generic inbox known (`info@`, `contact@`, etc.) | Generally skip until better contact found |
| **F** | No email anywhere | Contact research required |

Generic localparts to treat as tier E: `info`, `contact`, `hello`, `enquiries`, `investproposals`, `investment`, `general`, `invest`, `investments`, `office`, `team`, `ventures`, `funding`, `partners`, `deals`, `pitch`, `applications`, `mail`, `admin`, `secretary`, `ir`, `investor`, `investors`, `submissions`, `submit`, `startup`, `startups`, `apply`.

Strict-match rule for classifying tracker-name vs DB-partner: require both first and last token to match (case-insensitive, with parenthetical titles like `(Managing Partner)` stripped first). Single-token names match when the token matches either first or last on the other side and length ≥ 5.

---

## 5. The 12 Outreach Writing Rules (binding — read in full)

Full canonical text in `Outreach Writing Rules TF.md`. Summary:

**Rule 1 — Never assert what a fund does. Always hedge.** Do not write "I am reaching out because [FIRM] backs founders building …" etc. These are factual assertions Tristan cannot verify from outside; they read as presumptuous.

Use one of:

- "My understanding is that [FIRM] …"
- "From what I have read, [FIRM] …"
- "I understand that [FIRM] …"
- "As I understand it, [FIRM] …"
- "If I have read this right, [FIRM] …"

Then follow with "if that is right, [thesis-match sentence] …" so the reader can correct Tristan if he has misread the fund. Applies to **every** factual claim about the recipient's business, thesis, portfolio, or activities — not just the opening sentence.

**Rule 2 — Subject lines must be tailored per recipient.** Every cold email subject must be a recipient-specific variant keyed into what the recipient's fund is known for. Identical subject lines across a campaign read as mass-blast. Keep the core identifier consistent (e.g. `SkySails Power — airborne wind energy, €5M Series A bridge`) but vary the trailing descriptor in parens per recipient — e.g. `(Munich climate / European sovereignty)`, `(Flying Whales / hydrogen CVC)`, `(Airloom / novel wind precedent)`.

**Rule 3 — Always include Tristan's full bio paragraph.** Verbatim:

> "My name is Tristan Fischer. I have spent twenty-five years building, financing and scaling capital-intensive businesses — from Citigroup's project finance team, where I worked on US$5 billion of infrastructure transactions, through Shell Technology Ventures, to founding Lumicity as a solar and wind developer and serving as Executive Chairman of C-Capture, a carbon capture business backed by IP Group and BP Ventures. Most recently I founded and ran Fischer Farms, one of the largest vertical farming businesses in the world, for a decade. Since stepping down as CEO earlier this year, I have been approached by a number of companies who have asked me to help them raise capital."

The truncated version is not acceptable for a first-contact email. Note Drax is **not** a backer and must not appear.

**Rule 4 — Never send a duplicate first-contact.** Before creating a draft, check Gmail for any prior thread to that recipient with the same project subject. If a first-contact pitch has already been sent, do not create a new "Dear [Name], My name is Tristan Fischer…" draft — frame follow-ups explicitly as follow-ups. If the recipient received a different-project email before (e.g. Panatere before SkySails), open with an acknowledgement paragraph like: _"I wrote to you recently about Panatere, the Swiss circular-metals company I have been helping to raise. I wanted to reach out separately about a second company I am working with, as the fit is quite different."_

**Rule 5 — FishFrom video in every FishFrom email only.** Link: `https://drive.google.com/file/d/1NaBR14yfBOzrS9GiauCRYDEYs6JpBh7O/view` — attributed to Andrew Robertson, placed before the 20-minute ask. **Never in SkySails or Panatere emails.**

**Rule 6 — Right person at the right firm.** If contact research shows a named person has moved firms, write to them at the new firm with the new email AND find a replacement named partner at the old firm so both are covered. Update both the xlsx tracker and the Forge Capital DB.

**Rule 7 — Update the Forge Capital DB when new contacts are discovered.** Any new email, new named partner, or correction found during research goes into a SQL migration file in the Kite Power folder. Key columns on `investor_partners`: `name, title, email, email_previous, email_source, email_verified, email_verified_at, created_at, updated_at`. Note: **no `notes` column on `investor_partners`** — partner-level provenance lives in `email_previous` + `email_source`; narrative notes belong on `investors.notes`. Key columns on `investors`: `firm_name, website, notes, updated_at` — **no `status` column on `investors`**; firm-level status is in the xlsx trackers, not the DB.

**Rule 8 — Status taxonomy on xlsx trackers.** See section 3 above.

**Rule 10 — Canonical paragraph order.** Exactly:

1. Salutation ("Dear [Name]," or "Dear [Rank] [Surname],")
2. Tristan's bio paragraph (Rule 3 full version)
3. The company paragraph (named founder, technology, primary market + adjacencies, supporting validation — round size, grants, academic roots, programmes)
4. Hedged understanding of the fund (Rule 1 hedged) + "if that is right, [thesis match]"
5. Video link (Rule 5, FishFrom only)
6. Ask for 20 minutes, with specific slots (see section 7)
7. Sign-off (Rule 12)

Leading with the fund-understanding paragraph is a bug, not a style choice. Never rearranged.

**Rule 11 — Never congratulate, flatter, or personally remark on the recipient.** No "congratulations on your recent close", no "I enjoyed your piece in [outlet]", no "great to see [portco] announce X". The only permitted personal hook is a **factually verifiable** one (shared prior firm, named prior investor in one of Tristan's businesses, known mutual contact). State it briefly, without congratulation.

Example of a permitted hook (Schroders Greencoat): _"a personal note is that Greencoat previously owned Lumicity, the solar-and-wind developer I founded and ran, for a period (a successful investment on both sides), so this is a reconnection more than a cold introduction."_

**Rule 12 — LinkedIn in sign-off.** Every first-contact cold email ends with:

```
Best regards,
Tristan Fischer
tristan.fischer@gmail.com
https://www.linkedin.com/in/tristanfischer/
```

Rendered as a bare link so it's clickable in plain-text clients.

---

## 6. Company paragraph templates

Place immediately after the bio, before the hedged fund paragraph.

### SkySails

> One of those is SkySails Power, led by founder and CEO Stephan Wrage. SkySails is the global leader in airborne wind energy, with the only commercially operational energy kite system in the world — large automated tethered kites that fly figure-of-eight patterns at altitudes well above conventional turbines, generating electricity by pulling on a ground-based generator. The technology addresses wind sites that are structurally or economically difficult for tower-based turbines, and delivers materially higher capacity factors per tonne of installed hardware. The company has commercial pilots running and a production-capable facility in Hamburg. The current €5M Series A bridge is filling, and Kembara — one of Europe's largest deep-tech and climate growth funds — has indicated it wants to lead a €25M Series B once the bridge milestones are met. Two serious investors have independently converged on SkySails in parallel, and the terms on the bridge are attractive for investors coming in at this stage.

Note: SkySails Group's original business was the **SkySails Marine cargo-ship kite-propulsion system** (large towing kites pulling container ships). The ship-propulsion heritage is relevant when writing to maritime, naval or dual-use investors and should be surfaced in the fund paragraph (not the company paragraph) for those recipients.

### Panatere

> One of those is Panatere, a Swiss company operating a short-loop recycling system for precision-grade steel and specialty alloys used in Swiss watchmaking and precision manufacturing — taking machining swarf and end-of-life components straight back to metallurgical-grade feedstock without the downcycling losses of a conventional foundry route. The business sits at the centre of a luxury supply chain that is actively trying to prove provenance and circularity, and the process is protected by a portfolio of granted patents.

**Do not name a Panatere CEO.** Tristan's counterpart on the Panatere raise is Andreas Cser at Fraser Finance, not a Panatere employee, and the operative framing is always about the company rather than named leadership.

### FishFrom

> One of those is FishFrom Technologies, co-founded by Andrew Robertson, with commercial trials at Swansea University and a Finnforel beta site in Finland. FishFrom has developed a photocatalytic ozonation water-treatment system for land-based aquaculture — producing activated oxidants in-situ to clean recirculating water with materially less chemical input and no chlorine residuals, and raising stocking density and welfare outcomes for salmon and trout producers. The business has closed a £500K EIS seed round and has been awarded approximately £473K in Scottish Enterprise grant funding, and is now opening a bridge round ahead of the first full-scale farm deployment.

---

## 7. The ask — specific slots, not "next week or two"

Positive-reply audit shows specific slot offers get faster engagement than abstract "book my Calendly". Use 3–5 real free 30-minute windows from Tristan's Google Calendar (Europe/London), spread across mornings, afternoons, and days of the week. Show each in BST with UTC and CET offsets so international recipients can pick without arithmetic. Example:

> Would any of the following 30-minute slots work for a call? I am in UK time (BST, UTC+1). If none of these work I will happily suggest others.
> - Tuesday 28 April, 10:00 BST (09:00 UTC / 11:00 CET)
> - Wednesday 29 April, 15:00 BST (14:00 UTC / 16:00 CET)
> - Thursday 30 April, 09:30 BST (08:30 UTC / 10:30 CET)
> - Monday 4 May, 14:00 BST (13:00 UTC / 15:00 CET)
> - Wednesday 6 May, 11:00 BST (10:00 UTC / 12:00 CET)

Pull fresh slots per batch via the Google Calendar `suggest_time` tool with `attendeeEmails=['primary']`, duration 30 minutes, weekdays 09:00–17:00 BST, over a 10-working-day window.

---

## 8. Salutation details

- Default: `Dear [First name],`
- Strip honorifics (`Dr.`, `Prof.`, `Mr.`, `Ms.`, `Mrs.`, `Sir`) before picking the first name.
- If the first token is a **rank or professional title** (`Admiral`, `Ambassador`, `Captain`, `Honorable`, `General`, `Colonel`, `Commander`, `Lieutenant`, `Major`, `Senator`, `Governor`, `Commodore`), use `Dear [Rank] [Surname],` — e.g. `Dear Admiral Selby,` for Admiral Lorin Selby. Never `Dear Admiral,` (treats the rank as a first name).

---

## 9. Subject-line construction (Rule 2 in practice)

Format: `<Workstream identifier> — <concise project description> (<per-recipient angle>)`

Standardised prefixes (derived from positive-reply audit on 12 Mar–20 Apr threads — the structure that drew warm responses from Linn at CERN, Jerome at Air Liquide, Jan at Join Capital, Chris/Helen at Pangaea, Aurélien at Shift4Good):

- `SkySails Power — airborne wind energy, €5M Series A bridge (<angle>)`
- `Panatere — circular Swiss-watchmaking metals, Series A (<angle>)`
- `FishFrom Technologies — aquaculture water treatment, £500K EIS seed (<angle>)`

The `<angle>` should be 2–5 words pulled from the DB's `why_fit_hint` or `sector_tags`, specific to the recipient. Examples:

- `(Flying Whales / hydrogen CVC)` — Air Liquide
- `(DACH deep-tech hardware)` — Alpine Space Ventures
- `(Munich climate / European sovereignty)` — Matterwave Ventures
- `(Airloom / novel wind precedent)` — Crosscut Ventures
- `(Lumicity / Greencoat history)` — Schroders Greencoat (Rule 11 hook)
- `(ship-propulsion heritage / dual-use maritime angle)` — Mare Liberum
- `(seafood category adjacency)` — CPT Capital (FishFrom)
- `(natural-resources platform)` — The Reservoir (FishFrom)

Every subject in a batch must be unique. A classifier check after generation should confirm `len(set(subjects)) == len(subjects)`.

---

## 10. Hedged fund paragraph — construction

Structure:

```
{hedge} {firm} {fund_clause}. If that is right, {bridge}.
```

Rotate hedges across the batch so the campaign doesn't read as a template: "My understanding is that", "From what I have read,", "As I understand it,", "From what I can gather,", "I understand that".

The **fund_clause** is a verb-phrase starting with "is", "has", "runs", "invests", "backs", "takes", "operates", etc. — turns the firm name into a natural-reading assertion. Source material for the fund_clause is the DB's `why_fit_hint` and `thesis_summary`; paraphrase rather than quote verbatim, and strip any trailing "a natural fit for [X]" clauses which belong in the bridge, not the fund_clause.

The **bridge** names the company being raised (SkySails / Panatere / FishFrom) and makes the specific link to the recipient's stated or implied interest. Keep to one sentence where possible.

For **low-confidence** rows (where the fund's stated thesis is adjacent at best), append one escape-hatch sentence: _"If I have misread the fit here, I would welcome the correction."_

---

## 11. Pre-send cross-checks

Before turning drafts into Gmail drafts, run these checks for every recipient in the batch:

1. **Gmail history** — search `from:<email> OR to:<email>` for any prior thread. Flag anything found.
2. **Master tracker lookup** — open `260416 Master Investor Tracker TF.xlsx` / `Master Tracker` sheet, find the firm row, and read the status in the workstream you're about to email. Flag any status ≥ `+3 Email sent`.
3. **Cross-workstream prior contact** — same Master row, other workstreams. If the firm has `+3` or higher on a different workstream, you need to decide: same-person (use "wrote to you about X" acknowledgement) vs different-person (proceed as fresh first-contact but be aware the firm has been approached).
4. **Bounces** — check the commentary for `-2 Bounced`. If the email in your draft matches a bounced address, do not send.
5. **Handover** — if another partner at the firm is already at `+6.5 Handover to company`, exclude the row from cold outreach and route the new workstream through the existing counterpart instead (e.g. Air Liquide's Jerome Breteau is on Panatere at +6.5 — a SkySails approach to Armelle Levieux via a group inbox would be counterproductive; route through Jerome).

---

## 12. Verification — rule-compliance pass after generation

After producing a batch, programmatically verify on the set:

- Drax does **not** appear in any body.
- LinkedIn URL appears in every sign-off (`https://www.linkedin.com/in/tristanfischer/`).
- Bio phrase `"twenty-five years"` appears in every body.
- At least one hedging phrase from the Rule 1 list appears in every body.
- FishFrom video URL appears **only** in FishFrom bodies (and in every FishFrom body).
- The ask phrase `"20 minutes"` or equivalent appears in every body, with specific slot list.
- Subject lines are all unique.
- No flattery tokens (`congratulations`, `great to see`, `loved your`, `enjoyed your`, `impressive work`, `excited to see`) appear in any body.
- For SkySails drafts: Kembara and the €5M Series A bridge framing appear.
- Salutations — no `"Dear Admiral,"` or `"Dear Ambassador,"` bare-rank forms.

---

## 13. Batch output

Produce two deliverables per batch:

1. **Excel review file** (`YYMMDD <batch descriptor> TF.xlsx`) with columns: `#`, `Workstream`, `Firm`, `Tier`, `Confidence`, `Recipient`, `Email`, `Subject`, `Body`, `Tracker row`, `Note`. Colour-code by workstream and confidence. Include a Summary tab with totals, excluded rows, low-confidence flags.
2. **Markdown mirror** (`YYMMDD <batch descriptor> TF.md`) with the same drafts rendered one-per-section for quick reading in any editor.

Do not create Gmail drafts until Tristan has approved the batch. Send in sub-batches of 10–15 per session so he can tweak-and-send rather than all at once.

---

## 14. After sending

- Update each row's status on its workstream tracker to `+3 Email sent`, set `Initial Contact Date` (if blank) and `Last Contact Date` to today, and append a dated commentary entry.
- Mirror the status changes into the Master tracker.
- If a recipient's DB entry was updated during research (new partner, corrected email), write a SQL migration to `forge-capital-<topic>-YYYY-MM-DD.sql` and note in the session log that it needs to be applied.

---

## 15. Known example — use as reference

A full worked example of a batch (56 drafts across SkySails/Panatere/FishFrom, dated 2026-04-23) is at:

- `~/Documents/Kite Power/260423 AB Drafts Batch v5 TF.xlsx`
- `~/Documents/Kite Power/260423 AB Drafts Batch v5 TF.md`

Notable edge cases handled in that batch: Air Liquide excluded (generic inbox + existing +6.5 handover); three "prior Panatere, same person" rows get the acknowledgement opener (Air Street Capital / Nathan Benaich, DNV Ventures / Kaare Helle, SDCL / Jonathan Maxwell); Schroders Greencoat leads with the Lumicity/Greencoat ownership hook (Rule 11 permitted); Mare Liberum reframed around the SkySails Marine ship-propulsion heritage for Admiral Lorin Selby; five low-confidence rows flagged with the "if I have misread" escape hatch.

---

*Last updated: 2026-04-23.*
