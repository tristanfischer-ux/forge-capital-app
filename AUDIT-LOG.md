# AUDIT-LOG.md — Wren Aerospace dummy walkthrough 2026-04-23

Persona: Wren Aerospace, UK, high-altitude aerial surveillance drone (20km).
Audit account: tristan.fischer@gmail.com (DEV_SKIP_AUTH dev session).
External email destination: tristan.fischer@mac.com.

Status legend: ✓ works · ⚠ rough · ✗ broken · 🔧 fixed in commit


## Day 0 — onboarding

- ✓ Created campaign `AUDIT · Wren Aerospace · Investor` via SQL (id `229e605b-…`)
- ✓ /home loads with Wren as active campaign — topbar updates correctly
- ⚠ Find-a-Match section not in `.section-title` list — uses `.hero-title` instead. Minor inconsistency vs other sections; doesn't break anything but breadcrumbs/screenshot enumeration that scans `.section-title` misses it.
- ⚠ No "create campaign" UI in the app — had to insert via SQL. [VALUE] in IMPROVEMENTS.


## Day 1 — discovery (Wren in /match)

- ✓ Dump-info box accepted Wren snippet → Haiku synthesised to clean elevator paragraph + auto-detected Pre-Seed/Netherlands/€1.5M-€3M/aerospace fields. Filter bar pre-filled correctly.
- ✗ **CRITICAL: Find matches returned only 4 results** despite the DB containing 705 sector-matching investors with embeddings (171 even within nomic-768 cosine top-500 of the Wren query).
- 🔧 **Root cause: pgvector HNSW `ef_search` defaults to 40** → silently capped EVERY ANN query at 40 candidates regardless of LIMIT. The lexical reranker then trimmed those further. Fixed in migration `019_match_investors_bump_hnsw_ef_search.sql` — `set_config('hnsw.ef_search', 2*match_count)` inside the RPC.
- ✓ After fix: 1,000 candidates scored, top 25 displayed. Top results include **Seraphim Space Capital, Space Capital, Omnes Capital, RWE Principal Investments, European Innovation Council, Breakthrough Energy, Battery Ventures, Foresight Group, Balderton, Dawn**. Genuinely thesis-relevant.


## Day 2 — shortlist

- ✓ Tick 5 result-cards + Shortlist to approval sheet → 5 `+0 Pending approval` rows landed in `campaign_partners` for Wren (Air Street Capital, Climate Investment, Lowercarbon Capital, Omnes Capital, Seraphim).

## Day 3 — approval drop-zone (counterpart reply parser)

- ✓ Pasted 5-line reply, clicked Parse with Haiku → all 5 verdicts matched (Seraphim via fuzzy contains: "Seraphim Space Capital").
- ✓ Apply 5 verdicts → DB shows correct status_code per verdict (+1 Air Street, +1 Seraphim, -3 Lowercarbon "[hardware capex outside their model]", -3 Omnes "[SKIP] no aerospace mandate", +0 Climate "[FLAG] for follow-up next quarter"). Approver notes timestamped + tagged.

## Day 4 — verification gate

- ✓ Tier breakdown renders correctly. 2 corresponded · 1 hunter-verified · 2 unverified · 1 generic-blocked (counts include the new Wren rows).
- ✓ "Resolve email" button on the unverified tier opens the EmailHuntModal cleanly.

## Day 5 — draft + create Gmail draft

- ✓ Email override (insert into partner_email_overrides for Lewis Jones at Seraphim → tristan.fischer@mac.com) succeeded.
- ✗ **CRITICAL: override didn't propagate to /tracker/[id]/draft page** — the page kept showing "Lewis Jones (no email on file) · No tier". The `getInvestorModalData` query in `lib/queries/investorModal.ts` reads partners_mirror directly and ignored the overrides table. Other surfaces (match-score, EmailHuntModal) honour overrides via their own helpers; the draft page didn't.
- 🔧 Fixed in this commit: investorModal.ts now does a `partner_email_overrides` lookup keyed by every partner_id in the sibling list and applies override.email + override.email_tier as the effective values returned from the query. RLS scopes the overrides table to the current user automatically — same pattern as match-score.ts post-audit fix.
- ✓ After fix: draft page shows `tristan.fischer@mac.com` with the override tier badge. Clicked "Create Gmail draft" → success ("Draft created"). Real draft now sits in Tristan's Gmail awaiting send.
- ⚠ All 3 template paragraphs render placeholder warnings: `[Credibility paragraph missing]`, `[Company paragraph missing]`, `[Per-investor synthesis template missing]` — Wren campaign has no `email_templates` row. Honest behaviour, but for a new campaign it should auto-seed defaults OR the templates page should redirect a brand-new campaign to a "build your first template with Haiku" flow.

