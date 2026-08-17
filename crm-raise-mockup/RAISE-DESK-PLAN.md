# Investor Relationship Desk

**Status:** plan only. No production code changes in this pass.
**Win state:** you can work the raise from a web desk whose source of truth is a database, look at the same relationship from the company you are raising for *and* from the investor, and download the familiar Excel file as a snapshot. After cutover, a write to a tracker-shaped xlsx by an agent is a named failure, not background noise. Humans use the desk; Excel is a generated snapshot.
**This pass:** research, plan, OpenRouter council, clickable dummy site. Sign-off before any schema or app change.

---

## The short answer

Yes. A database should be the live system. Excel should come out as a backup.

You do not need a new product, and you should not buy Affinity or Visible as the main desk. The split you described already exists in `forge-capital-app`:

- **Truth database** — Forge Capital investor intelligence (`~/.forge-capital/forge-capital.db`, ~15,015 firms / ~82,985 people). Nightly mirror into Supabase `investors_mirror` / `partners_mirror`. This is the public-or-shareable layer: who the investor is, thesis, team, cheque, portfolio.
- **Personal raise desk** — `campaigns` × `campaign_partners` × `contact_events` in the apex-outreach Supabase project. This is private: what *you* are doing with that investor, on which raise, at which status.

The live work is still happening in `260812 Master Investor Tracker TF (CANONICAL).xlsx` (2,671 investor rows, 63 columns, eight raise companies). The app already has a tracker, approval gate, Gmail ingest, calendar ingest, and Excel import/export — but the spreadsheet is still the place agents and humans write. That is why it keeps making mistakes.

The build is: **make the personal raise desk the write surface, keep Forge Capital as the read-only investor encyclopaedia, and emit Excel from the database.**

---

## What you actually have today

Opened and counted. Not inferred from filenames.

### The spreadsheet (the thing that is going wrong)

File opened: `/Users/tristanfischer/Developer/Forge-Capital/260812 Master Investor Tracker TF (CANONICAL).xlsx`

| Sheet | What it is |
|---|---|
| Dashboard | Odysseus merge stats (2,542 unified names). Generated 2026-07-30. |
| README | Merge rules. Jordan's Odysseus rules: visible = do not outreach; hidden = low priority; not on list = primary candidate, needs Jordan approval. |
| **Master Tracker** | Live book. 2,671 rows × 63 columns. |
| Legend | `PRIMARY_CANDIDATE` / `DO_NOT_OUTREACH` / `LOW_PRIORITY_OK` |
| Odysseus — DO NOT outreach, Low priority, Candidates approval, Jordan overlap AUDIT | Permission slices of the same book |

Row 1 of Master Tracker is grouped headers. Row 2 is the real columns.

**Shared investor block:** Last contact (days ago) · Contacted? ticks for eight companies · Investor · Website · Contact · Email · Sector · # companies.

**Eight raise companies, each with the same five fields:** First sent · Latest · Days since · Status · Commentary.

Companies, with how many rows have the contacted tick:

| Company | Ticked |
|---|---|
| Space Solar | 1,053 |
| Odysseus | 613 |
| FishFrom | 547 |
| SkySails | 473 |
| Panatere | 415 |
| Casper | 254 |
| US Arbitrage | 243 |
| Hooley RF | 9 |

**654 of 2,671 investors (24.5%) are ticked on two or more companies.** That is the exact problem you named: one person, four or five raises.

Status is not a closed list. Same book mixes:

- Canonical codes: `+3 — Email sent`, `+5 — Follow-up sent`, `+0 — Pending approval`, `-3 — Disqualified`
- Near-duplicates: `+5 Follow-up sent` (no dash), `+1 — Approved (awaiting draft)` vs `+1 — Approved — awaiting draft`
- Jordan free text: `Rejected`, `Ongoing discussions`, `No answer`, `no meeting yet/recently (<6 months)`, `Rejected (open for a second round)`
- Permission states written as status: `0 — Permission requested (awaiting SkySails)`

Only 1,582 of 2,671 rows have an email. One contact name and one email serve every company on the row.

Older "canonical" copies sit next to it (`260807`, `260810`) plus a stack of dated backups. There is no single file the machine can trust.

April 2026 audit of the earlier book (`audit-20260421/00-tracker-schema.md`) already named the shape: one row per firm, parallel status blocks per raise, `Days Since` as `=TODAY()-Latest`. The book has grown from 3 companies / 453 rows to 8 companies / 2,671 rows. The shape did not change. The error surface did.

### The database that already models this correctly

`forge-capital-app` (Next.js + Supabase project `kgkajatjyqfetdtbzmwg`, V4 visual system). Home already redirects to a two-page split:

- `/discover` — "truth database"
- `/pipeline` — "personal database"

(`app/(authed)/home/page.tsx`, comment dated 2026-04-30.)

| Table | Job |
|---|---|
| `investors_mirror` | Nightly copy of Forge Capital firms. Source of truth remains `~/.forge-capital/forge-capital.db`. |
| `partners_mirror` | People at those firms. |
| `campaigns` | One row per raise: SkySails, FishFrom, Panatere, ForgeOS, Fischer Farms customer, … Intent is `investor` / `customer` / `supplier`. |
| `campaign_partners` | **The tracker row.** Unique on `(campaign_id, partner_id)`. Status code lives here, not on the firm. |
| `contact_events` | Timeline. Channels already include `gmail`, `whatsapp`, `signal`, `slack`, `call`, `zoom`, `google_meet`, `in_person`, `linkedin`, `meeting`, `manual`. Calendar events de-dupe on `google_calendar_event_id`. |
| `investor_outreach_state` | Cross-raise roll-up per person: last campaign, email count, relationship status. |
| `scheduled_sends` | Outbound queue. Database trigger refuses anything that is not `+1` or `+2`. |

Partner page `/partner/[id]` already shows every campaign that person is on, plus recent events. Match already warns: "EBRD is already in Panatere at -2 Bounced — adding them to SkySails risks a double-ask."

Gmail sync and calendar sync exist as launchd scripts. Inbox page reads inbound `contact_events`. Tracker can import an xlsx (fuzzy firm match) and export a per-campaign xlsx.

Core Forge Capital SQLite also has unused `interactions` and `emails` tables (0 rows). Do not revive them. The live CRM tables are in Supabase.

### What is missing (so you still live in Excel)

1. **No "Today" across all raises.** `/investors` is already a cross-campaign list of everyone you have reached out to. `/pipeline` is still behind a campaign switcher. Neither answers "who am I meeting, who replied, who is stuck, on any company, this morning."
2. **Investor 360 is a profile, not a desk.** `/partner/[id]` already lists campaign links. Status changes still happen on the campaign tracker. The write surface is not the person.
3. **WhatsApp, iMessage, Signal are schema-only.** No ingest. Channel check allows them; nothing writes them.
4. **Excel is still a write path.** Agents and Cowork write the xlsx. The app then *parses it back* with fuzzy firm matching (`lib/ingest/tracker.ts`). That is a second source of mistakes on top of the first.
5. **Status is not enforced.** App comment in `004_campaign_partners.sql` says the taxonomy is not a database constraint "on purpose." The spreadsheet proves why that was a mistake.
6. **Jordan / company-permission rules are columns on the Odysseus group**, not a first-class permission object.
7. **One person / one email on the spreadsheet row**, even when the right counterpart differs by raise.
8. **Gmail OAuth for one-click drafts is still a Tristan-in-person blocker** (`BLOCKERS.md`). Clipboard + weekly file output is the current send path.

---

## Why the spreadsheet keeps making mistakes

These are structural. More care will not fix them.

1. **Wide table pretending to be a database.** Eight repeating groups × five fields = 40 campaign cells on every row. A write to "the wrong SkySails commentary" is a one-column slip.
2. **Free-text status.** `+5 Follow-up sent` and `+5 — Follow-up sent` are different strings. Jordan's `Rejected` is not `-1`. Dashboards and agent scripts that group by status split the same fact.
3. **One contact for every raise.** 137 Ventures is ticked on Space Solar *and* US Arbitrage with different statuses. The row still has one email.
4. **Days-since is a formula on a date someone forgot to stamp.** If Latest is empty, the April audit formula falls back to First Sent, then to blank. "Last contact 451 days ago" on a Jordan import is a date, not a relationship.
5. **Fuzzy ingest back into the app.** Header aliases include `name`, `company`, `sw`. Token-subset matching of firm names is how the wrong investor gets the wrong status.
6. **Many files named canonical.** Agents pick the newest-looking xlsx. Humans edit another. Backups look live.
7. **Permission mixed into status.** `0 — Permission requested` is not a pipeline stage. It is a gate on whether you may talk. Mixing them is how Odysseus names leak onto a send list.
8. **Agents write prose into cells.** Commentary is an append-only diary crammed into one cell. There is no event, no channel, no thread id.

Visible's 2026 fundraising-CRM piece (opened: https://visible.vc/blog/best-crm-for-fundraising/) puts the break at ~20 active relationships. You are running ~2,670 firms and ~200-email waves. The spreadsheet is past the point where it can be the live system.

---

## What good CRM practice actually is (for this job)

Searched and opened vendor and comparison pieces, not just titles.

| Source | What it actually said | What we take |
|---|---|---|
| Visible, "Best Investor CRM for Startup Fundraising" (2026) | Spreadsheet dies around relationship 20. One source of truth. Pipeline stages, not "warm/cold". Log every touch. Engagement signal (deck opens) is what sales CRMs miss. Affinity is built for the fund, not the founder. | Stages, one write surface, weekly pipeline review. We already have a better investor encyclopaedia than Visible Connect. |
| Affinity vs Attio (affinity.co comparison; Causo Hub 2026) | Affinity's product *is* automatic email + calendar capture and a relationship graph. ~$2,000/user/year, sold to funds. Attio is the founder/emerging-fund default: People / Companies / Deals objects, Gmail+Calendar sync, custom objects. | Capture activity; do not ask you to log it. Do not buy Affinity. Do not replace our 15k-firm thesis graph with Attio's empty objects. |
| Attio VC industry guide | Standard objects: People, Companies, Deals. Custom objects for funds / commitments. Relationship attributes between them. Views for "not contacted recently." | Our objects are already: Person (`partners_mirror`), Firm (`investors_mirror`), Raise (`campaigns`), Deal-row (`campaign_partners`). |
| Affinity "automatic activity capture" | Records are created from email and calendar. Relationship strength is derived, not typed in. | Gmail + calendar sync we already have is the right spine. Extend it; do not add a "log this email" habit. |
| Folk / Gritt 2026 fundraising lists | Unified inbox (email, LinkedIn, WhatsApp) is now table-stakes on founder CRM lists. | WhatsApp and iMessage belong on the timeline. They should not become send channels without the same approval gate as email. |
| Your own April tracker audit + app UX audit | Cross-campaign conflict banner is the thing that prevents a real mistake. Hedged knowledge. Honest empty states. | Keep the approval gate and the double-ask warning. Promote them to the investor 360, not only Match. |

**Practices that survive all of the above, and match how you actually work:**

1. **Activity is captured. Status is decided.** Emails, meetings, texts land by themselves. You (or an approver) set `+6` / `+8` / `-1`.
2. **Two objects, always.** Firm (who they are) is not the same as the raise-row (what we are doing with them *on SkySails*).
3. **Two views of the same rows.** Company view = 200-row wave. Investor view = this person across every company.
4. **Permission is a gate, not a status.** Jordan do-not-contact, company "you may approach", bounced, already-contacted-elsewhere.
5. **One write surface.** Agents write to the database. Excel is an export. Imports from Excel are preview-only and rare.
6. **Nothing leaves without approval.** Already law in this repo. Dummy site and future code keep it.

What we will not copy: Visible's data-room-and-monthly-update product (you are running eight raises, not one startup's IR). Affinity's fund-side deal flow. HubSpot "Lead / Closed Won."

---

## Recommended architecture

```
┌─────────────────────────────────────────────────────────────┐
│  FORGE CAPITAL  — truth database (shareable)                │
│  ~/.forge-capital/forge-capital.db                          │
│  firms, people, thesis, portfolio, embeddings               │
│  nightly → investors_mirror / partners_mirror               │
│  UI today: /discover  /investors  /investor/[id]            │
└────────────────────────────┬────────────────────────────────┘
                             │ read-only join on firm id / person id
┌────────────────────────────▼────────────────────────────────┐
│  RAISE DESK  — private (you, then named approvers)          │
│  campaigns · campaign_partners · contact_events             │
│  permission_rules · outreach_state                          │
│  UI to build: Today · Company · Person · Inbox · Calendar   │
│  Excel export: on demand + nightly snapshot                 │
└───────────────┬─────────────────────────────┬───────────────┘
                │ captured                     │ decided
     Gmail · Calendar · iMessage · WhatsApp    Status · notes
     (read)                                    Approval · send
```

**Hard rule:** Forge Capital rows are not updated by a raise. A raise may *link* to a firm and *override* the email used for that campaign. Thesis, website, team stay on the truth side.

**Hard rule:** one `campaign_partners` row per (raise × person). Not per firm. If two partners at the same firm are in play, that is two rows. The spreadsheet cannot say this; the database already can.

**Hard rule:** `contact_events` is append-only. Commentary cells go away. A Wispr paste becomes a `call` event with synthesised actions (schema already has `synthesised_actions`).

### Status

Keep the existing 17-code list from `lib/status-codes.ts` (enumerated below). Add a **database check** so free text cannot land. `needs_review` is **not** an 18th status. It is a boolean `import_needs_review` on the raise-row; `status_code` may be null until you pick a code. A null status cannot send.

| Code | Label | Send-eligible |
|---|---|---|
| `+12` | Committed | no |
| `+11` | Term sheet | no |
| `+10` | NDA / diligence | no |
| `+9` | Meeting held | no |
| `+8` | Meeting scheduled | no |
| `+7` | Meeting offered | no |
| `+6.5` | Handover to company | no |
| `+6` | Response received | no |
| `+5` | Follow-up sent | no |
| `+4` | Auto-reply / OOO | no |
| `+3` | Email sent | no |
| `+2` | Drafted — ready to send | **yes** (queue only) |
| `+1` | Approved — awaiting draft | **yes** (queue only) |
| `+0` | Pending approval | no |
| `-1` | Declined | no |
| `-2` | Bounced | no |
| `-3` | Disqualified | no |

Send-eligible means a row may enter `scheduled_sends`. It does **not** mean the message has left. Human send from Gmail after a draft is created is outside the database trigger; the honest guarantee is: *the desk will not queue or auto-transmit unless `+1`/`+2` and permission allow*. Clipboard / "open in Gmail" is labelled as a human send and cannot be technically gated. That claim is now narrowed (council).

**Company permission** is already a field on `campaign_partners`. Live check (migration `20260505000000_add_permission_status.sql`) allows only:

- `not_required` — self-managed raise; no counterpart tick needed
- `pending_approval` — on the sheet you send to Stephan / Andrew / Jordan / Olivier
- `approved` — counterpart said yes
- `denied` — counterpart said no; cron and draft-send already refuse this

Do **not** invent `requested` / `granted` / `held` / `low_priority` on this column. Those words belong elsewhere.

**Person-global prohibition** (`contact_policy`): Jordan `DO_NOT_OUTREACH`, `⛔ DO NOT CONTACT` in a firm name, bounce, you-said-never. Scope: person, optional firm, channel or `any`, source, reason, expires_at. Precedence: person-global `any` > person-global channel > firm-global > campaign `permission_status`. Default deny if any applicable row is a block.

Outreach Rule 10 (7 Aug): drafts may exist while status is `+1` and permission is still `pending_approval`. **Send** requires `permission_status` in (`approved`, `not_required`) **and** status `+1` or `+2` **and** no blocking `contact_policy`. Permission emails to counterparts carry **name + website only**.

The `scheduled_sends` **database trigger** (`029`) still only checks `+1`/`+2`. Application code already refuses `denied`. Step 1 alters the trigger so a queue insert cannot land when permission is `pending_approval` or `denied`. That is extending 029, not replacing it.

Jordan's three Odysseus rules become `contact_policy` rows (and the Odysseus review sheets), not colours and not extra `permission_status` values. Override of the 14-day cross-raise cooldown stores `override_reason` + actor + timestamp on the queued send.

### Schema changes this plan implies (council: must name them)

| Migration | What |
|---|---|
| `status_code` CHECK | Only the 17 codes or null. Existing invalid rows quarantined first. |
| `import_needs_review` boolean | Separate from status. |
| `status_raw` text | Frozen spreadsheet string. |
| `scheduled_sends` trigger v2 | Also rejects unless campaign permission and `contact_policy` allow. |
| `raise_people` | Local person/firm for Excel-only names. Optional `partners_mirror_id`. Mirror refresh cannot delete these. |
| `contact_event_campaigns` | Junction: one event → 0–N raises. |
| `contact_events.gmail_message_id` | Unique partial index, same idea as `google_calendar_event_id`. |
| `mutation_audit` | Actor, table, row, before, after, session. Written only by the mutation RPC. |
| `investor_outreach_state` | Rebuilt by trigger on `contact_events` / `campaign_partners` (not nightly). |
| `contact_policy` | Person/firm/channel prohibition with provenance. |

### Activity capture — what is real, what is new

| Channel | Today | Plan |
|---|---|---|
| Gmail | Sync script + inbox page. OAuth still a physical-Mac blocker for drafts. | Keep as spine. Finish OAuth when you are at the Mac. Match threads to person by email, then to the *campaign* by subject / existing `campaign_partners` / last raise talked. Ambiguous → Inbox "file this". |
| Google Calendar | `calendar-sync.mjs` every 10 minutes. Matches attendees to `partners_mirror`. | Surface on Today and on the person. Unmatched attendees sit in a "who is this meeting?" queue. |
| WhatsApp | Channel allowed, no ingest. | Phase 2. WhatsApp Business Cloud API is the only legitimate bulk path; personal WhatsApp has no supported export API. Practical V1: share-to-desk or paste a thread; store as `whatsapp` event. Do not scrape the phone. |
| iMessage | Not in schema. | Phase 2. **Privacy boundary (council):** raw `chat.db` never leaves the Mac. The desk may store only metadata you approve (handle, time, direction, raise). Message body stays local unless you paste it. Group chats excluded. Never a send path. |
| LinkedIn / phone / Wispr | Manual "log interaction" on partner page. | Keep. Wispr paste already designed to synthesise actions. |

Cross-raise filing: if you email one person about FishFrom and they reply about SkySails, the event still belongs on the *person*. Status change is per raise. The person page shows both.

---

## The interface (dummy site)

Standalone HTML, light mode, V4 tokens (`#f5f6f8` ground, indigo accent). Not wired to production. Clickable enough to argue over structure.

Files (written after this plan is accepted into the session, still no app/schema change):

`/Users/tristanfischer/Developer/forge-capital-app/crm-raise-mockup/`

Eight pages, one shared chrome (top nav + raise filter that can be "All raises"):

1. **Today** — the missing home. Next 7 days of meetings. Unfiled replies. Follow-ups due. "Stuck > 7 days" by raise. Double-ask warnings (same person, two live raises).
2. **Company** — SkySails (example) as a 200-row raise. Kanban + table of the 17 codes. Permission gate visible. "Add from Forge Capital" search. Export Excel for *this* raise (Stephan/Andrew sheet shape).
3. **Person** — investor 360. Who they are (from Forge Capital). Every raise they are on, with its own status. Unified timeline (email, meeting, note). "Talking about four companies" is the first thing you see.
4. **Firm** — the fund. All partners. All raises. Thesis. "Already contacted here" is a banner, not a cell.
5. **Inbox** — every inbound, all raises, with a raise chip and a "file to raise" control when ambiguous.
6. **Calendar** — week view. Each event linked to a person and a raise. Unmatched attendees flagged.
7. **Excel backup** — shows that the xlsx is a download: Master (wide, eight companies) and per-raise counterpart sheets. Timestamped. Not editable in the desk.
8. **Gap audit** — what the dummy does not pretend to do (see below).
9. **Review queue** — unmatched firms, unmapped statuses, dual-run drift. This is the cutover operator surface.

Dummy data is the hard cases, not the clean ones: one person on FishFrom + SkySails + Odysseus with divergent statuses; a Jordan `DO_NOT_OUTREACH` still ticked on another raise; a pending `+1` approval; a firm-matched row with three partners (ambiguous); a meeting this afternoon; a drift row.

### What the dummy will not fake

- Live Gmail or Calendar.
- A working WhatsApp/iMessage pipe.
- Send. The dummy has a "Create Gmail draft" button that does nothing, labelled as such. Approval gate stays visible.
- Real investor rows from the database.

---

## Excel as backup, not as the book

Two exports, generated from `campaign_partners` + `contact_events`:

1. **Master (wide)** — same grouped headers you already read, so old muscle memory still works. Status written as the canonical `+N — Label` string only. Days-since computed at export time. Commentary cell becomes "last 3 event summaries," not the diary.
2. **Per-raise counterpart sheet** — Stephan / Andrew / Jordan shape. One company. Permission column explicit.

Cadence: button on the desk + nightly file into `Forge-Capital/exports/YYYY-MM-DD Master Investor Tracker TF.xlsx`. Filename never contains the word `CANONICAL`. The database is canonical.

**Import stays, demoted.** Preview-only. Ambiguous firm matches cannot apply. After cutover, agents are forbidden from writing the xlsx.

---

## What we will not do

- Stand up a second Next app or a new Supabase project.
- Move raise activity into `~/.forge-capital/forge-capital.db` (that file is the shareable encyclopaedia).
- Buy Affinity / Attio / Visible as the system of record. Optional later: push a *read-only* subset to Attio if a counterpart wants it.
- Auto-send email, WhatsApp, or iMessage.
- Scrape WhatsApp or iMessage off the phone.
- Change Forge Capital pipeline scripts, embeddings, or nightly push — except a one-line note that raise state does not live there.
- Make `status_code` accept Jordan prose.

---

## Implementation sequence (after you approve the dummy)

No code in this pass. Order of real work, each independently shippable:

| Step | What | Why this order |
|---|---|---|
| 0 | You click through the dummy (including Review queue). Decide Today vs Company as the morning page. Confirm WhatsApp/iMessage are Phase 2. | Stops us building the wrong home. |
| 1 | Quarantine invalid statuses and already-queued sends. Status CHECK. `contact_policy`. Trigger v2 on `scheduled_sends` (status **and** permission). Inventory every outbound path (queue, Gmail draft, clipboard, weekly file). | Stops new bad data. Narrows the send claim to what we can enforce. |
| 1.5 | Mutation RPC only for agents: audit row, no direct table credentials, bulk-mutate cap. Pre-import test that `partners_mirror` ids survive a refresh. | Agents must not write the live table the way they wrote cells. |
| 2 | Idempotent import of ticked raise-cells. Review queue until every ticked cell has a disposition. Commentary → note events. | Desk is not born empty. |
| 3 | **Today** + All-raises filter + Approvals card. **Single-user until you answer open question 2.** | Morning scan leaves the xlsx. |
| 4 | Person page is the write surface (status per raise, log, open-in-Gmail labelled as human send). | Dual perspective is real. |
| 5 | Master + per-raise export. Archive old canonical files. Nightly snapshot. Agent xlsx writes become a named failure. | Backup you asked for. |
| 6 | Calendar on Today + Person. Unmatched-attendee queue. | Meetings stop living only in your head. |
| 7 | Gmail OAuth in person (`BLOCKERS.md`). Token security and scope review included — not "three minutes" as a promise. | Capture quality jump. |
| 8 | iMessage metadata-only (local) + WhatsApp paste. | Texts on the timeline without uploading `chat.db`. |

Steps are **sequentially** shippable, not independent. The existing `+1`/`+2` trigger stays; it is **extended**, not replaced. RLS for Stephan/Andrew is unchanged until you choose multi-user.

---

## Open questions — defaults locked (you skipped the picker)

Proceeding with the recommendations so the dummy can be built:

1. **Morning page: Today**, raise filter defaulting to All.
2. **V1 audience: you only.** Counterparts stay on permission Excel until you say otherwise.
3. **WhatsApp / iMessage: Phase 2.** Email + calendar first.
4. **`/discover` stays the shareable encyclopaedia.** Raise status never appears there.

NED outreach is a separate book and is out of scope. Brine Mining is not in the 260812 column groups.

---

## Write-model ownership (council: must)

Which table is allowed to answer which question. One owner each.

| Question | Owner | Others |
|---|---|---|
| Who is this firm / person? | Forge Capital SQLite → `investors_mirror` / `partners_mirror` | Raise desk may overlay email/phone for *this campaign only* |
| What stage is this person on *this* raise? | `campaign_partners.status_code` | Never stored on the firm |
| May we contact them, on this raise, on this channel? | `campaign_partners.permission_status` + person-global prohibition | Global `DO_NOT_OUTREACH` beats any campaign `+2` |
| What happened? | `contact_events` (append-only) | An event may link to 0, 1, or many raises |
| What is queued to send? | `scheduled_sends` | Re-checks status **and** permission at fire time |
| Cross-raise roll-up (last touch, open campaigns) | `investor_outreach_state` | **Derived.** Rebuilt from the tables above. Never written by hand |

`investor_outreach_state` is per *person*, not per raise. Per-raise truth stays on `campaign_partners`.

### Cross-raise coordination (council: must)

For the 654 people on two or more raises:

1. Person 360 shows every raise side-by-side. No single "overall status."
2. A `contact_policy` block (Jordan do-not-outreach, name-prefix ban) blocks send on **all** raises.
3. A `-1` / `-2` / `-3` on any raise in the last 14 days suppresses new outbound on other raises unless you override with a reason.
4. Today and the approval screen list *every open raise* for that person before a send is queued.
5. Events live on the person. Company view shows only events linked to that raise (plus a count of "other-raise activity hidden").

### Identity contract for the Excel import (council: must)

**Firm and person are two decisions.** A website or firm-name hit identifies the *firm*, not the partner. Auto-apply a `campaign_partners` row only when the *person* is unique.

| Step | Resolves | Auto-apply? |
|---|---|---|
| Partner email exact, unique | Person | Yes |
| Partner email exact, 0 or 2+ hits | — | Review queue |
| Firm website host / exact or normalised firm name | Firm only | Create or attach a `raise_people` stub labelled "Primary (imported)" if the firm has one partner; if the firm has several partners, **review queue** — never pick one. |
| No firm match | — | `raise_people` + stub firm, flag `not_in_encyclopaedia` |

No token-subset apply. Shared inboxes and duplicate emails are always ambiguous.

`raise_people` is private to the raise desk. Optional later merge onto `partners_mirror.id` when the encyclopaedia catches up. Nightly mirror upserts on the Forge Capital integer id (already the PK); **pre-import test:** run one mirror refresh and confirm a sample of ids still exist. If a future refresh is ever delete+insert, add a mapping table before any FK depends on it.

**Idempotency:** import is an upsert on `(campaign_id, raise_person_id)`. Each run has an `import_batch` id. Commentary becomes one `manual` `contact_event` per (row, company) with a deterministic key; re-runs do not duplicate. Rows a human has edited after import are **not** overwritten unless `--clobber`. `status_raw` is immutable.

**Commentary:** imported as a note event (raw text). Not synthesised into fake dates or channels. Export later shows last 3 *event* summaries; the original note remains.

### Status mapping for the existing book

Anything not in this table goes to `needs_review` and cannot send.

| Spreadsheet text (seen in the 260812 book) | status_code | permission |
|---|---|---|
| `+12` / Term sheet / Committed variants | matching `+N` | unchanged |
| `+5 Follow-up sent` (missing dash) | `+5` | `not_required` unless that raise uses a counterpart sheet |
| `+1 — Approved (awaiting draft)` and `+1 — Approved — awaiting draft` | `+1` | `approved` if counterpart already ticked; else `pending_approval` |
| `+1 — Draft held (awaiting COMPANY approval)` | `+1` | `pending_approval` |
| `+3 Email sent` (missing dash) | `+3` | leave permission |
| `0 — Permission requested (awaiting …)` | `+0` | `pending_approval` |
| `Rejected` / `Rejected (open for a second round)` | `-1` | Jordan-visible → `contact_policy` block; else leave permission |
| `Ongoing discussions` | `+8` if a meeting event exists, else null + `import_needs_review` | Odysseus → `contact_policy` from Jordan rule |
| `No answer` / `no meeting yet/recently` | `+3` if a send date exists, else null + `import_needs_review` | from Jordan rule |
| `+0 — US candidate (Space Solar)` | `+0` | `pending_approval` |

Raw spreadsheet status is stored on import as `status_raw` and never discarded.

### Cutover (council: must)

**Write authority by phase**

| Phase | Who writes the live book |
|---|---|
| Now | Spreadsheet (honest). |
| After Step 1.5 (mutation RPC) + import preview | Review queue. Spreadsheet frozen. |
| Dual-run | Database. Nightly export is a snapshot. |
| After gate | Database only. |

1. Freeze `260812`. Move `260807`, `260810`, and dated backups into `Forge-Capital/archive/read-only/`. `exports/` is the only xlsx directory agents may read; agent users get filesystem read-only on that folder. Filename never contains `CANONICAL`.
2. Import into the review queue. Every *ticked* source cell (raise × row) gets a terminal disposition: matched, local stub, excluded, or unresolved. **Unresolved ticked cells block cutover.** A 95% figure is a progress metric, not a pass. Denominator = ticked raise-cells (sum of the eight company ticks = 3,607), not unique firms.
3. Dual-run: database wins on conflict. Drift rows go to the review queue. Gate is **drift count = 0** or a numbered waived list — not "explained."
4. "Today is usable" = you run the morning scan from Today for **five consecutive working days** without opening a tracker xlsx. Then agent writes to tracker-shaped xlsx are a named cutover failure.
5. Import stays preview-only after that.

**Rollback:** restore the last database backup + latest nightly export. The frozen 260812 file is for import forensics only. Re-opening it as the live book would discard post-import events and is not rollback.

**Master (wide) export flattening:** if two people at the same firm are on the same raise, the wide file gets **two rows**, firm name suffixed with the person (`Northwind Ventures — Helena Voss`). We do not merge two statuses into one firm row. Watermark: `generated_at`, `raise_person_id`, banner "snapshot — edit in the desk." A watermark is not a file lock; enforcement is archive + read-only exports dir + CLAUDE.md law.

---

## Mistake classes → mechanism

Excel does not make mistakes. The workflow does. Each class has a named kill.

| Class | Mechanism |
|---|---|
| Invalid / split status strings | CHECK on 17 codes; `status_raw` kept |
| Permission mixed into status | Keep live `permission_status` enum; Jordan/DNC on `contact_policy`; trigger v2 |
| Agent script writes the wrong Excel column | `space-intel-refresh.py` hard-codes col 9/10 as investor/website; on the wide book those are SkySails Status/Commentary. Kill: stop writing the xlsx |
| Already-contacted leaks onto a NEW approval pack | Space Solar pack had to post-filter **849** names. Kill: `campaign_partners` + `contact_policy` are the exclusion source, not a heuristic on commentary |
| Second Gmail account | Some Space Solar / US Arb threads live in Fractional Forge Gmail. Kill: desk must attach events to a person even when the mailbox is not the primary OAuth account; Phase 1 documents the gap, Phase 1.5 adds the second mailbox or labels those events `mailbox=fractional_forge` |
| Wrong firm from fuzzy ingest | No token-subset; review queue |
| Wrong *person* at a firm | Firm match ≠ person match; stub or review |
| Double-ask across raises | Person 360 + cooldown + approval card lists every open raise |
| Forgotten follow-up | Today work queue |
| Agent writes the wrong cell | Mutation RPC + audit; no direct table write; xlsx archived |
| Many files named canonical | Archive + exports-only directory |
| Dual-write drift | DB wins; drift queue; gate = zero drift |
| Send without approval | `scheduled_sends` trigger; human Gmail send labelled, not claimed as gated |

---

## Council

Two OpenRouter rounds. Direct `https://openrouter.ai/api/v1/chat/completions`. Not the second-opinion MCP. Round 1 saw a digest (`max_tokens` 16,000). Round 2 saw this **full** plan (`max_tokens` 16,000, plan 28,993 characters).

### Round 1 (digest)

| Seat | Model | Verdict | Out tokens | Cost |
|---|---|---|---|---|
| Corroborate | `z-ai/glm-5.2` | approve with changes | 2,906 | $0.004 |
| Escalate | `openai/gpt-5.6-sol` | approve with changes | 2,855 | $0.089 |
| Honesty | `minimax/minimax-m3` | approve with changes | 6,798 | $0.008 |
| Adversarial | `x-ai/grok-4.5` | approve with changes | 2,475 | $0.016 |
| Long-horizon | `moonshotai/kimi-k3` | approve with changes | 6,828 | $0.105 |

Coverage **5 / 5**. Folded: identity queue, `status_raw`, cutover, Jordan mapping, cross-raise rules, write-model ownership, event attribution.

### Round 2 (full text)

| Seat | Model | Verdict | Out tokens | Cost |
|---|---|---|---|---|
| Corroborate | `z-ai/glm-5.2` | approve with changes | 3,750 | (see raw) |
| Escalate | `openai/gpt-5.6-sol` | **reject** (specification, not direction) | 5,578 | (see raw) |
| Long-context | `qwen/qwen3.7-max` | approve with changes | 7,056 | (see raw) |
| Long-horizon | `moonshotai/kimi-k3` | approve with changes | 7,036 | (see raw) |
| Honesty | `minimax/minimax-m3` | first call empty (`finish_reason=length`); recall: mixed, 2,487 out | 2,487 | $0.005 |

Sol is the honesty-risk seat (~11–18% non-hallucination on the routing chart). Unique Sol items are **not** auto-blockers. Findings agreed by **2+ seats** were treated as blockers and are now in the plan:

1. Firm match ≠ person match; `raise_people` stub; never pick a partner at a multi-partner firm.
2. `needs_review` is a boolean, not an 18th status.
3. `scheduled_sends` trigger must check permission, not only `+1`/`+2`.
4. Name every migration. Rebuild `investor_outreach_state` on write, not nightly.
5. Wide export: one row per *person*, firm name suffixed.
6. Agents write only through an audited mutation RPC.
7. Import is an idempotent upsert; no-clobber of human edits.
8. Drift gate = zero (or numbered waivers), not "explained."
9. Archive 260807 / 260810 / backups; exports directory read-only to agents.
10. Gmail de-dupe key, same idea as calendar.
11. Review queue is a first-class dummy page.
12. Import commentary as note events so the desk is not born empty.
13. Rollback = database backup + latest nightly export, not re-opening 260812.
14. Today ships single-user until the counterpart question is answered.
15. iMessage: metadata you approve, body stays on the Mac (Sol + keep from R1).
16. Send-gate claim narrowed: queue is gated; human Gmail send is labelled.

MiniMax recall (prose claims only): 654/2,671, Excel-as-write-path, Forge read-only, and Phase 2 deferral are **supported** by the source rail. Dual-run length, 14-day cooldown, and a 95% match figure are **judgment**, not evidence — which is why cutover now uses complete disposition + zero drift, not those percentages as a pass. The `+1`/`+2` queue gate is migration `029_scheduled_sends_approval_gate.sql` (`enforce_scheduled_send_approval_gate`), cited in `forge-capital-app/CLAUDE.md`.

Unanimous keep across both rounds: no bought CRM, no second app, Forge read-only, permission ≠ status, no scrape, no auto-send.

The 14-day cooldown is a starting rule you can change. It is not measured from your reply latency.

Raw JSON: `~/.grok/sessions/%2FUsers%2Ftristanfischer/01a00609-6413-7341-b163-bea2fd17521f/council/` and `.../council/round2/`.

---

## Source rail

| Opened | One line of what it said |
|---|---|
| `260812 Master Investor Tracker TF (CANONICAL).xlsx` | 13 sheets; Master Tracker 2,671 × 63; 654 multi-company; 8 raise groups. |
| `~/.forge-capital/forge-capital.db` | 15,015 investors, 82,985 partners. `interactions`/`emails` empty. |
| `forge-capital-app/supabase/migrations/001`, `004`, `020`, `024` | campaigns; campaign_partners; outreach_state; contact_events channels include WhatsApp. |
| `forge-capital-app/lib/status-codes.ts` | 17-code taxonomy `+12`…`-3`. |
| `forge-capital-app/lib/ingest/tracker.ts` | Fuzzy xlsx ingest; multi-campaign group headers; preview-then-apply. |
| `forge-capital-app/app/(authed)/home/page.tsx` | `/discover` = truth database, `/pipeline` = personal database. |
| `forge-capital-app/CLAUDE.md` | Nothing sends without approval. Mockup-first suspended unless you ask (you asked). |
| `supabase/migrations/029_scheduled_sends_approval_gate.sql` | Trigger `enforce_scheduled_send_approval_gate` — queue insert refused unless campaign_partner is `+1` or `+2`. |
| `supabase/migrations/20260505000000_add_permission_status.sql` | Live enum: `not_required` \| `pending_approval` \| `approved` \| `denied`. |
| Explore pass 2026-08-15 (app + Excel) | `/investors` = cross-campaign tracker; SPACE-INTEL still names the xlsx as system of record; `space-intel-refresh.py` writes cols 9–10; Rule 10 company-approval; Fractional Forge second mailbox; NED is a separate book. |
| `audit-20260421/00-tracker-schema.md` | April 2026: 453 rows, 3 companies, Days-Since formulas. |
| https://visible.vc/blog/best-crm-for-fundraising/ | Spreadsheet dies ~20 relationships; Affinity is fund-side. |
| https://attio.com/help/reference/industry-guides/vc | People / Companies / Deals + relationship attributes. |
| https://www.affinity.co/comparison/affinity-vs-attio | Affinity = automatic capture + relationship graph for private capital. |
| https://hub.causo.ai/compare/attio-vs-affinity | Attio for founders; Affinity for $200M+ funds whose edge is the graph. |
| `~/.claude/docs/model-routing.md` | Standing council seats used below. |
