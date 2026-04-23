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

