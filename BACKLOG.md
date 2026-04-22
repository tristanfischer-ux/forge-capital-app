# forge-capital-app — backlog

Durable record of agreed-but-not-yet-built work. When a session is tight
on context, open this first to pick up where the last one stopped.

Last updated: 2026-04-22 (late evening).

---

## Cross-navigation link graph

Tristan 2026-04-22: *"If you go from one bit of information to
another, you can go for it? For example, you can click on a partner
and then go to another investor, and they've grown from an investor
to a portfolio company back to another investor, etc."*

Split into four levels. **Levels 1 + 2 shipped 2026-04-22** (commit
pending at time of writing — see latest `feat(nav):` commit). Levels
3 + 4 remain:

### Level 3 — Portfolio company index (`/portfolio/[slug]`)

**What it is**: a first-class route for each portfolio company with
the set of investors that back them, plus any metadata the pipeline
captures (sector, stage, HQ, round history if we have it).

**Why it matters**: unblocks the investor → portfolio company → other
investors traversal. Without this the graph stops at the firm.

**Data state today** (2026-04-22):
- Portfolio names live ONLY as free-text inside
  `investors_mirror.synthesis_data.portfolio_companies` (JSONB,
  parsed client-side via `parsePortfolioCompanies()` in
  `lib/queries/investor-profile.ts`). No canonical entity, no id,
  no cross-ref.
- Forge Capital pipeline SQLite (`~/.forge-capital/forge-capital.db`)
  DOES have a proper `portfolio_companies` table with
  `investor_id` FKs — `research/04-research-portfolio.js` populates
  it. Numbers at audit time: ~12,000 portfolio rows.
- Nothing in the pipeline pushes that table to apex-outreach today.
  `14-push-capital-app.py` only carries investors + partners.

**Build steps** (estimated ~2-3 hours):
1. Migration `018_portfolio_companies.sql` on apex-outreach —
   table with columns `(id bigint pk, forge_capital_id bigint unique,
   investor_id bigint fk → investors_mirror, company_name text,
   slug text, sector text, stage text, hq_location text, round text,
   round_at text, amount_usd numeric, source_url text,
   last_synced_at timestamptz)`. Index `(investor_id)` and `(slug)`.
2. New pipeline script
   `~/Developer/Forge-Capital/research/14c-push-portfolio-to-capital-app.py`
   parallel to `14-push-capital-app.py`. Reads SQLite
   `portfolio_companies` + upserts to Supabase. Idempotent on
   `forge_capital_id`. Dry-run default, `--live` opt-in.
3. Launchd plist `com.forgecapital.push-portfolio` @ 06:50 BST
   (15 min after the investor push at 06:30 → 06:45 embeddings → 06:50
   portfolio).
4. New Next route `app/(authed)/portfolio/[slug]/page.tsx`. Slug is
   a url-safe version of `company_name` (e.g. "ginkgo-bioworks").
   Displays the company + list of investors that back it (joined via
   `portfolio_companies.investor_id → investors_mirror`).
5. Query layer `lib/queries/portfolio-profile.ts`: `getPortfolioCompany(slug)`.
6. Breadcrumb trail `Home → Find a Match → <investor name> → <company>`.
7. Wire: on `InvestorProfileView` `PortfolioCard`, the chips today
   are plain strings — wrap each in `<Link href={'/portfolio/' + slug}>`.

**Blocker to watch**: slugs are not unique in the wild ("Acme" exists
at multiple investors). Two options:
- (a) Canonical `portfolio_companies` de-duped at push time (same
  company_name → single row with many investor_ids via an N:N
  junction table). Cleaner but needs `portfolio_investors` junction.
- (b) Just key each row by `forge_capital_id` + `investor_id` — accept
  duplicates, show all occurrences on `/portfolio/[slug]`.

Start with (b) for speed, upgrade later.

### Level 4 — Graph traversal UI

**What it is**: a "related firms" panel on every profile (investor OR
partner OR portfolio company) that surfaces the nearest-neighbour
nodes one hop away. Clicking any node navigates to it.

Example on `/investor/6494` (Felicis):
- **Related firms** card — other investors who share portfolio
  companies with Felicis, ordered by overlap count. "Sequoia (3
  shared) · Index (2 shared) · NEA (2 shared)".
- **Shared partners** card — partners who have appeared at BOTH
  Felicis and another firm (rare but happens on moves / boards).

On `/partner/[id]`:
- **Other firms this partner has touched** — via employment history
  if we have it, else just "currently at Felicis Ventures" (level 1
  already shows this).

On `/portfolio/[slug]`:
- **Also backed by** — the other investors for that company (already
  the spine of level 3).

**Build steps** (estimated ~half day):
1. Depends on level 3 being live (junction table makes the joins
   trivial).
2. New queries per surface: `getInvestorRelatedFirms(investorId, limit=8)`,
   `getPartnerCrossFirms(partnerId)`, etc.
3. SQL: GROUP BY with a count of shared portfolio entities.
4. UI: reuse `.ms-card` layout, one row per related entity, link to
   its page.
5. OPTIONAL stretch: a graph visualisation (d3 or vis.js) on a
   dedicated `/graph/[entity]/[id]` route. Probably deferred to a
   Phase 10.

---

## Other known follow-ups (smaller)

- **Replicate env vars in Vercel are dead weight.** `REPLICATE_API_TOKEN`
  is still registered in Production + Development but no code reads it.
  Clean up via `vercel env rm REPLICATE_API_TOKEN production && rm preview
  && rm development` when convenient.
- **`OPENAI_API_KEY` not yet in Vercel Preview env.** CLI hiccup on the
  initial add — Production + Development landed, Preview didn't. Retry
  with the interactive `vercel env add OPENAI_API_KEY preview` next time.
- **Nightly `com.forgecapital.push-embeddings` cron pushes nomic
  vectors, not OpenAI ones** — will overwrite OpenAI doc embeddings
  every morning at 06:45. Either (a) disable that plist and schedule
  the Next-side `scripts/embed-investors.mjs` to run nightly instead,
  or (b) modify the Python script to call OpenAI. Option (a) is simpler.
- **Gmail sync daemon advances cursor on partial-failure runs** —
  should only advance when `errored === 0`. Documented in
  `~/.claude/projects/-Users-tristanfischer/memory/forge-capital-app.md`.
  Low priority — the 15-min retry still converges.
- **Middleware → proxy rename** (Next 16 deprecation warning). Not
  urgent but needed before the next Next major.

---

## Closed (kept for grep-ability)

- ✅ Level 1 partner profile route — `/partner/[id]` (commit
  `[pending]` 2026-04-22 late).
- ✅ Level 2 cross-link partner names in match / tracker / investor
  profile / draft / investor modal (same commit as L1).
- ✅ Semantic search via OpenAI `text-embedding-3-small` dim=768
  (commit `5c64022`). FFT pitch live-verified: Burnt Island,
  Sandwater, Faber, Scottish Enterprise, Sandwater in top 5.
- ✅ Deck upload Haiku synthesis (commit `0ba2ace`).
- ✅ Breadcrumbs across authed shell (commit `9f11949`).
- ✅ "Full control over Vercel + Supabase" rule in CLAUDE.md
  (commit `9f11949`).
- ✅ Gmail sync live verified — 221 messages ingested (commit
  `37cd6c8`).
- ✅ Pipeline filter bug fixed — backlog draining at 720/day.
- ✅ Weekly discovery cron (`com.forgecapital.discover`, Sunday 03:00).
- ✅ Opus 4.6 → 4.7 bumped pipeline-side.
- ✅ Embeddings column + nightly sync infra.
- ✅ Phase 8 Gmail sync daemon + constraint fix.
- ✅ Find-a-Match: filter bar, 25/page, pagination, Why-them first,
  CONFIDENCE, dump-info box.
- ✅ Tracker drop-zone + email stats column.
- ✅ Verification gate: all 5 dead buttons wired.
- ✅ Review "Go to Tracker" wired.
- ✅ Approval return drop-zone + Haiku parser.
- ✅ AI drafter in templates (per-section Haiku).
