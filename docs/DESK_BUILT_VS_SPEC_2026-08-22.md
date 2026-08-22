# Raise desk as built vs Claude Cowork spec

Written: 22 August 2026, evening BST.  
For: Tristan Fischer, and Claude Cowork.  
Live app: `https://forge-capital-app.vercel.app`  
Repo: `~/Developer/forge-capital-app`  
Cowork spec this is compared against: `SPEC_Outreach_and_Chasers.md` in this folder.

This note is what the desk **actually does**, not what a plan said it would do. Where it fails Tristan’s screenshots, that is named.

---

## 0. One paragraph

Tristan’s daily job is: see who he is meeting, write notes on that call, chase people he already wrote to, and find new investors for a named raise. Cowork specified two pipelines for the last two of those — **first-touch outreach** and **chasers** — in painstaking MUST-language: named person, NeverBounce-verified address, principal yes before cold mail, five-block letter, Gmail **draft only**, then a 10–14 day / 3–6 week chase cadence that gets shorter and ends with an easy no.

Grok Build built a five-tab desk (Today, Calendar, Current Call, Chasers, Outreach) that **does not send mail**. Chasers and Outreach are the two Cowork pipelines, but they are thinner than the spec, and on production they have been showing empty lists because the shared book (Corpus) keys on Vercel were blank and because Outreach only treated “replied or met” as “what has been working”. Space Solar on the book is mostly **approved / awaiting sign-off**, not “responded”. That is why Tristan’s Outreach screenshots say “That programme is not on the book” and “Found 0 lookalikes” while the book in fact has Space Solar (`SS`), 123 approved rows, and 805 awaiting sign-off.

That is a fail against both the screenshots and the spec.

---

## 1. What each tab does, in order

### 1.1 Today — `/today`

**Job:** What is on now, this morning.

**It loads**

- Live-ish meetings from Google Calendar merged with a week cache and Corpus activities (`getDeskToday`).
- Inbound replies from the last week (Gmail-derived desk replies).
- Quiet and collision **counts** from Corpus (`getCorpusTodayStats`).
- A “Next” box from `proposeTodayJob`.

**It shows**

- Heading: today’s date.
- Buttons: Current Call, Chasers.
- **Next:** the next live meeting (name · clock), one sentence, **Open the briefing**. If there is no meeting: quiet people → Chasers; else approved-not-written → Outreach; else “nothing timed”.
- Four cards: meetings this week, replies this week, quiet ≥ 10 days, collisions. Cards jump to the list on the page, or to `/chasers` / `/collisions`.
- The meeting list (cheat-sheet snippets).
- The replies table (used to live on Inbox).

**It does not**

- Send mail.
- Hunt new investors.
- Chase anyone by itself.

**What Tristan saw that was wrong**

- “No forced job this morning” while Ryan Owen was at 14:00, because a meeting more than 120 minutes away was ignored. Fixed: next meeting is always the job.
- “Open Company” leftover. Removed.
- Number tiles clipped by a hover-hint wrapper. Removed.
- “Shared book: 0 firms” on production. That was Corpus env empty, not an empty universe.

---

### 1.2 Calendar — `/raise-calendar`

**Job:** The shape of the week. Yesterday, today, and seven days ahead. Colour by programme if the title or guests look like one.

**Click:** opens **Current Call** for that block (`/meeting/gcal:…`), not Google Calendar. “Open in Google” is a secondary button on the briefing if the event has a link.

**It does not** file people, draft mail, or chase.

---

### 1.3 Current Call — `/call` and `/meeting/[id]`

**Job:** Everything about this slot so Tristan can take the call and dump notes.

`/call` redirects to: meeting happening now, else last opened (`fc_current_call` cookie), else next upcoming, else an empty state.

**The briefing is supposed to show**

1. **Person** — role, programmes, last touch, notes. From Corpus `core.people`.
2. **Firm** — sectors, domain, notes. From `core.firms` / `match_firm`.
3. **LinkedIn** — Apollo people/match if the key works; otherwise a Brave search snippet (`site:linkedin.com/in "Name" Firm`). Never a model-invented bio. Link to the profile if we have a URL.
4. **What we have said so far** — Gmail `q=` on attendee emails plus Corpus `engage.activities`. Honest empty state if there is nothing to search.
5. **One notes box** (saves locally on the meeting). Thank-you and follow-up **Gmail drafts** if Rule 13 is green.
6. **Paste transcript** (Gemini / Meet blob → propose, then drafts).
7. **Correspondence table**, newest first.

**Match logic (after the Ryan Owen bug)**

- Guest emails from Google attendees **and** emails scraped from title/description.
- If no email: look up `full_name ilike %Ryan Owen%`. There is one Corpus row: `Ryan Owen ryan.owen@chevron.com` at Chevron Technology Ventures.
- Then `searchBook`, then `match_firm` for the firm hint.

**What Tristan saw that was wrong**

- “Ryan Owen is not a unique person on the book yet. File them before drafting.”
- “Chevron Technology Ventures is not a unique firm on the book yet.”
- “No attendee email to search.”
- LinkedIn snippet was present (Brave). Notes and drafts blocked.

**Why that happened**

- He **is** on the book. Production `FORGE_CAPITAL_DB_URL` / service role were empty strings, so Corpus counts were 0 and every lookup missed.
- The Google event had **no attendee list**, and the page only searched emails, not the name in the title.

**What it still does not do versus a staff briefing**

- It does not invent a bio.
- Thank-you drafts stay disabled until the person row is matched **and** `email_state = verified`.
- It does not auto-file a new person (and must not silently create a duplicate).

---

### 1.4 Chasers — `/chasers`

**Job:** Cowork Part Two, thin version. People Tristan already wrote to (or the tracker marked approached) who have not sent a real reply, quiet ≥ 10 days (default), **all programmes**.

**A chaser is a Gmail draft. Nothing sends.**

**List definition**

- Participations in `research | approved | approached | responded | meeting`.
- Not DNC.
- Quiet = last outbound (`email_out` / `draft` / `first_sent` / `latest_touch`) is ≥ N days ago, and no later real inbound (out-of-office does not count).
- **Also:** stage `approached | responded | meeting` with **no dated send imported** still appears (Odysseus has hundreds of approached rows with no `first_sent`). Shown as “no dated send”, not “0 people”.
- HO is listed and paused (not draftable).
- Yuri uses the customer/VoC chase text, not a raise pitch.

**UI**

- Default: **All programmes**.
- Chips: full names (Space Solar, SkySails, FishFrom…), with counts.
- Never written / Unverified are extra views.
- Bulk: **Create follow-up drafts for verified (up to 25 per click)**. Per-row button as well.
- Copy is `composeChaserDraft` — closer to Cowork chase type 2 (gentle, Calendly) than type 1 (momentum with news). There is **no** automatic choice of chase-1 vs chase-2 vs chase-3, **no** in-thread reply, **no** “if it is not one for you, just say the word” as a hard template on every row, **no** holiday softening.

**What Tristan saw that was wrong**

- FishFrom selected, chips labelled `SS SK FF`, “0 quiet for 10 days”. Read as nobody to chase.

**Why**

- An old `?code=FF` filter plus empty Corpus on production.
- Abbreviations on the chips.

**What it still does not do versus Cowork Part Two**

| Spec MUST | Built? |
|---|---|
| Silence timer 10–14 days then 3–6 weeks | One N-day filter (default 10). No second-step cadence. |
| Chase 1 only if there is news | Not implemented. Same gentle follow-up for everyone. |
| Chase 2 easy-no sentence mandatory | Not guaranteed in the template. |
| Always reply in the existing Gmail thread | New draft, not `replyToMessageId`. |
| Never re-introduce Tristan / no bio in a chase | Chaser composer has no bio. Good. |
| Each chase shorter than the last | Not modelled. |
| One chase per person across mandates | Not modelled. Collision is a separate table. |
| Detect send via sent-mail sync, then log `+5` | Draft is logged as `channel = draft`. Send detection is not this page. |
| Surface due chases on Today | Today has a quiet **count** only, not the named list. |

Local book, when Corpus is wired: tens to hundreds of quiet rows, not zero. Production zero was the empty keys plus the FishFrom filter.

---

### 1.5 Outreach — `/outreach`

**Job:** Cowork Part One, thin version. “Find more investors for this raise.”

**UI as built**

1. Pick a raise: Space Solar, Odysseus, FishFrom, Panatere, Casper, US Arbitrage. SkySails / Hooley / Yuri are not offerable (suspended / paused / not a raise).
2. **What has been working** — firms on that mandate at committed / meeting / responded / dataroom / **approved** / approached (after the fix). Sectors of those firms plus mandate text become lookalike tokens.
3. **Shape sample** — up to three people already **approved**, NeverBounce **verified**, never written. Full first-touch draft on screen. Tristan marks the shape, then hunts.
4. **Find N lookalikes** (default 20, max 50) — Corpus firms whose sectors overlap the seed, **not already on this mandate**. Needs a named person on the firm. Hunter/Apollo fill is **not** run automatically in the hunt (Hunter helper exists, unused in this click).
5. Tick rows → Gmail drafts, cap 25, Rule 13 + `evaluateDraftGate` + lint. Stage must be `approved` or the row will not draft (principal gate).
6. “Instruction for the next set” rewrites **undrafted** rows only.

**Compose** (`composeOutreachDraft`, after the five-block pass)

- Subject: `{Company} — {hook} ({ask})` when a hook exists; otherwise company + ask.
- Cold opener: hedged “my understanding is that {firm}…”.
- Company paragraph from `ask_summary`.
- Block 3 **only** if `thesisFromBook` finds sectors or a named portfolio-ish fact in `firms.notes`. Otherwise the row is `needs research` and **will not invent**.
- Bio on cold only (spec canonical bio). Warm: no bio.
- Twenty minutes + Calendly.
- Lint: Space Solar “prime” / Nasdaq-to-non-US / wrong mobile `7771 913 882` / paused mandate.

**What Tristan saw (the three screenshots)**

- Space Solar selected.
- “What has been working on Space Solar — **That programme is not on the book.**”
- No shape samples.
- Find 31 lookalikes → “**Found 0 lookalikes from the book.**”

**Why that is a fail**

On Corpus, Space Solar **is** on the book:

- Mandate `SS`, company_name Space Solar, status active, ask £10M seed.
- Participations (sample of 1,000): **approved 123**, **awaiting_signoff 805**, committed 3, disqualified 63, closed_lost 6.
- There is **no** `responded` / `meeting` in that slice.

The page said “not on the book” when `engage.mandates` returned no row. On production that happens if Corpus keys are missing (they were empty on Vercel; restored; `vercel env pull` still sometimes shows blank because secrets are redacted). Even with a live book, the old seed was only `responded | meeting | dataroom`, so Space Solar would show a **thin/empty working set** and lookalikes would score 0.

**What it still does not do versus Cowork Part One**

| Spec MUST | Built? |
|---|---|
| Candidates land in `core.import_quarantine` first | No. Hunt reads firms already on Corpus. |
| `match_firm` before creating a firm | Hunt does not create firms. |
| Provenance tags on the participation | Not written for lookalikes. |
| DNC / dupe / 21-day cross-mandate as hard stops | DNC skipped; collision flagged; dupe = skip firms already on the mandate (after fix). |
| Odysseus Jordan rules (DO_NOT_OUTREACH, Bpifrance, etc.) | Not encoded in Outreach. |
| Principal packet: name + website only, batch, parse reply with confirmation | Not built. Unapproved rows simply cannot draft. `/sign-off` still exists in More. |
| Rule 13 NeverBounce **before** the draft | Gate uses stored `email_state`. Hunt does not call NeverBounce on the 31. |
| Hunter/Apollo to **find** the named person if missing | Helper files exist; the Find button does not call them. |
| Warm vs cold mechanical; warm first sentence must reference the thread | `evaluateDraftGate` warm flag exists; opener is generic unless a thread is passed. |
| Subject per investor, not a merge | Attempted via `subjectHook` from sectors. Weak if sectors are empty. |
| Block 3 checkable, hedged, **not invented** | Honoured: no thesis → no draft. Consequence: many rows stay empty instead of researching. |
| Attachments never automatic; `[ATTACH BEFORE SENDING]` lint | Not in this UI. |
| Present reasoning: why this person, what Block 3 is based on, approval state | Partial: a “why” lookalike line. Not the full packet. |
| `engage.check_outreach_allowed` as the hard DB boundary | Not called. UI gate only. |
| Detect send, then `approached` + activity `email_out` | Draft activity only. |

So Outreach, as Tristan used it, **failed the job**. The code path is a lookalike-from-book sketch, not Cowork’s new-outreach machine.

---

## 2. Cowork spec — what it told Grok to build

Source: `SPEC_Outreach_and_Chasers.md`.

**Sentence:** find the right named human at an approved firm, verify the address, write an email whose middle paragraph proves Tristan understood *that* investor’s thesis, put it in Gmail as a draft, never send it; if silence, chase lighter and lighter, always offer an easy no.

**New outreach stages**

0. Candidate → quarantine → `match_firm`.  
1. Firm screen: DNC, duplicate, already in flight, 21-day sequencing, mandate rules (Jordan / Bpifrance / SkySails hold / Hooley paused / Yuri not a raise).  
2. Principal approval packet (Richard / Jordan / Stephan / Andrew / Tony). Name and website only. Parse the reply; silence is not consent.  
3. Rule 13: named individual, NeverBounce `verified`. No `info@`. No guessed Lockheed-style patterns.  
4. Warm or cold from Gmail/calendar/LinkedIn first-degree. Warm: first sentence references the thread; **no bio**.  
5. Five blocks: opener, company, **checkable thesis mapping**, bio (cold only), twenty-minute ask. Subject in the investor’s vocabulary.  
6. Draft, lint, hand off. Tristan sends.  
7. Log on detected send. Bounce handling.

**Chasers**

- Day 10–14: momentum chase **only with news**.  
- 3–6 weeks: gentle close-out with mandatory release valve.  
- Opportunistic third. Then `No answer`.  
- Always in-thread. Never a bio. Each chase shorter, each ask smaller.

**Never:** send, auto-attach, generic inbox, unverified, DNC, cold without principal yes, invent Block 3, Space Solar “prime” or £30M, SkySails NDA photos, Hooley before Tony, Yuri as a raise, phone `+44 7771 913 882`.

---

## 3. Scorecard — built vs spec

| Cowork requirement | Desk today | Verdict |
|---|---|---|
| Nothing auto-sends | Gmail drafts only; no Outreach/Chasers call to `messages.send` | **Hold** |
| Five-tab daily loop (Today / week / this call / chase / find) | Built. Inbox/Notes/Send removed from the top bar | **Hold** (IA, not in the spec, but matches how Tristan works) |
| Current Call: person, firm, mail, notes | Built; production missed Ryan because Corpus keys were empty and the invite had no guests | **Partial — data/match bugs** |
| LinkedIn blurb, not invented | Brave snippet. Apollo key returns payment 403 | **Partial** |
| Chasers: everyone quiet ≥10d, all programmes, bulk drafts | Built; production showed 0 under FishFrom + empty book; cadence/news/in-thread missing | **Partial** |
| Outreach: find N new, first few for shape, then rest, NB/Apollo, drafts, approve, modify loop | UI shell only. Screenshot: “not on the book”, 0 lookalikes. No quarantine, no principal packet, no Hunter on Find, seed ignored approved-only Space Solar | **Fail** |
| Principal yes before cold | Drafts blocked unless `stage = approved`. No packet, no parser | **Partial** |
| Rule 13 | Gate on stored `email_state`. No live NeverBounce in the hunt | **Partial** |
| Block 3 never invented | True, and therefore many rows produce no letter | **Hold on honesty, fail on research** |
| Jordan / SkySails / Hooley / Yuri narrative | SkySails/Hooley/Yuri excluded from Outreach picker. Jordan rules not in the finder | **Partial** |
| `check_outreach_allowed` DB gate | Not used | **Fail** |
| In-thread chasers + easy-no | Not used | **Fail** |
| 260817 Excel archive-only | Not written | **Hold** |

---

## 4. What “failing” means in the screenshots

1. **Outreach / Space Solar / “not on the book”** — false. `SS` exists. The live request did not see Corpus (empty Vercel keys) and/or looked only for replied/met firms, of which Space Solar has essentially none in the working slice.  
2. **Outreach / 0 lookalikes** — same. Seed tokens were empty, so overlap score was 0. The finder also never called Hunter/Apollo to **discover** people, which is the whole point of “email 31 new investors”.  
3. **Chasers / 0 quiet / FF** — filter + empty book. Not the true quiet universe.  
4. **Current Call / Ryan not on the book** — false. He is `e1fb25a6-…` / `ryan.owen@chevron.com`.

Cowork told Grok to build a **research → approve → verify → compose → draft → chase** machine. Grok built **chrome and two list pages** that, on production, often could not see the book.

---

## 5. What must be true before Outreach is honest

1. Production Corpus URL + service role must resolve `engage.mandates` for `SS` (not an empty env).  
2. “What has been working” must list **approved / approached / committed** firms, not only replied/met. Space Solar’s book is an approval pile, not a reply pile.  
3. Lookalikes must use mandate text (`£10M seed`, in-space assembly, etc.) when firm sectors are thin.  
4. Find N must actually **find people** (Hunter/Apollo + NeverBounce) for firms not yet on the mandate, then stop at `awaiting_signoff` until a principal packet is yes.  
5. Shape samples must come from the 123 approved Space Solar people who are verified, not from a never-written filter that returns [].  
6. Chasers landing URL is `/chasers` with **All programmes** and full names.  
7. Current Call matches calendar **names** to `core.people`, not only attendee emails.

Until (1)–(4) hold on production, Tristan is right: Outreach is failing.

---

## 6. Files (so Cowork can grep)

| Surface | Path |
|---|---|
| Today | `app/(authed)/today/page.tsx`, `lib/desk/mandate-state.ts` (`proposeTodayJob`) |
| Calendar | `app/(authed)/CalendarBoard.tsx`, `lib/capital/live-calendar.ts` |
| Current Call | `app/(authed)/meeting/[id]/page.tsx`, `lib/queries/resolve-meeting.ts`, `lib/queries/live-correspondence.ts`, `lib/capital/person-linkedin.ts` |
| Chasers | `app/(authed)/chasers/*`, `lib/capital/chasers.ts`, `lib/capital/voice.ts` `composeChaserDraft` |
| Outreach | `app/(authed)/outreach/*`, `lib/capital/outreach.ts`, `lib/capital/thesis-from-book.ts`, `composeOutreachDraft` |
| Spec | `SPEC_Outreach_and_Chasers.md` |
| Book | Corpus `fnusjztykxibqybuekvh`, schemas `core` / `engage` |

Nothing in those paths should call Gmail `messages.send` for Outreach or Chasers.
