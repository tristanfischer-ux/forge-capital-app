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

### Level 3 + Level 4 — STATUS: all shipped 2026-04-22 → 2026-04-23

Levels 1, 2, 3, and 4 are live. Graph traversal works all the way
round:

  /investor/A → /partner/X → /partner/X' at firm B → /investor/B
  → /portfolio/Y → /portfolio/Z → /investor/C → …

Commits:
- `eb2c80a` — L1 partner route + L2 cross-links
- `0e8aaeb` — L3 portfolio canonical + junction
- `fda7630` — L4a investor-profile canonical portfolio + related firms
- `8a1389e` — L4b portfolio "also backed by" card
- `f79e28a` — L4c partner cross-firm matches

Remaining stretch for later: graph visualisation (d3/vis.js on
`/graph/[entity]/[id]`). Not urgent; the hop-by-hop navigation feels
complete without it.

Below for the record — original level-by-level scope doc:

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

- **`OPENAI_API_KEY` not in Vercel Preview env** — Production +
  Development are set, Preview kept rejecting stdin-piped values with
  "Run one of the commands in next[] to complete without prompting".
  Needs `vercel env add OPENAI_API_KEY preview --git-branch=*` or
  a one-shot interactive `vercel env add` from a real TTY. Not
  blocking — Preview deploys fall back to lexical scoring cleanly
  when the key is absent.
- **Forge-Capital pipeline `.env` points at ForgeOS Supabase** —
  `NEXT_PUBLIC_SUPABASE_URL` in `~/Developer/Forge-Capital/.env` is
  the forgeos/nightshift project (`jyarhvinengfyrwgtskq`) not
  apex-outreach (`kgkajatjyqfetdtbzmwg`). New pipeline push scripts
  (14-push-capital-app.py, 14b-push-embeddings…, 14c-push-portfolio…)
  each sanity-check for the correct URL and refuse to run with the
  wrong one — so they fail safe, but the `.env` is still a landmine
  for any new script. Should set apex-outreach creds via the plists
  directly, or add a second `.env.capital-app` with the right vars.

---

## Closed (kept for grep-ability)

- ✅ **Level 4c — partner cross-firm matches** (`f79e28a` 2026-04-23).
  Same-email strong matches + same-name possible matches across
  different `investor_id`s. 418 email collisions / 3,120 name
  collisions exist today. UI labels kinds clearly so name-only
  matches don't fabricate a certainty.
- ✅ **Level 4b — portfolio "also backed by" card** (`8a1389e`
  2026-04-23). Portfolio page now shows other companies backed by the
  same investors. Verified on /portfolio/northvolt (10 related: H2
  Green Steel, Adionics, Alan, ...). Closes company → investor →
  company loop.
- ✅ **Level 4a — investor canonical portfolio + related firms**
  (`fda7630` 2026-04-23). Heartcore (27 portfolio entries, 1 related
  firm at 500-row push; will richen after tomorrow's 06:55 full push).
- ✅ **Level 3 — `/portfolio/[slug]` canonical + junction** (this commit).
  Migration 018 + `portfolio_companies` (slug-unique) + `investor_portfolio_links`
  junction + pipeline push script 14c + daily 06:55 BST cron.
  463 canonical companies / 412 junctions after initial --limit 500
  live run (projected ~64k canonical / ~93k junctions at full push).
  InvestorProfileView portfolio chips now link to the new route.
- ✅ **Discovery cron actually uses Haiku** (this commit). `USE_HAIKU=1`
  set in the plist + pipeline `.env`. Log message at `01-discover.js:70`
  now reflects real routing. Smoke-tested — 1 new firm landed within
  90s (VC Eclipse); Ollama provably not called.
- ✅ **Nightly embeddings cron swapped** (this commit).
  `com.forgecapital.push-embeddings.plist` renamed to `.plist.disabled`
  (nomic path). New `com.forgecapital.openai-embed-nightly.plist`
  runs `scripts/embed-investors.mjs` daily at 06:50 BST — OpenAI
  text-embedding-3-small at dim=768. Verified mid-run: 9349 rows
  fetched, batches 1-6 succeeded.
- ✅ **Gmail cursor-advance safety** (this commit). Cursor only
  advances when `errored === 0`. Partial failures now re-list the
  missed window on the next tick.
- ✅ **Replicate env vars cleaned** (this commit). Dead `REPLICATE_API_TOKEN`
  removed from Vercel Production + Development. Not present in Preview.
- ✅ **`middleware.ts` → `proxy.ts` rename** (this commit). Next 16
  deprecation warning gone; build output now shows `ƒ Proxy (Middleware)`.
- ✅ Level 1 partner profile route — `/partner/[id]` (commit `eb2c80a`).
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
