# Handover: Pipeline → App Connection (2026-04-29)

For the database/pipeline terminal. This explains how the forge-capital-app reads investor data, what's working, what's broken, and what needs to happen on the pipeline side to unlock the next level of matching quality.

## Architecture overview

```
Scrape (research scripts)
  → SQLite (forge-capital.db + corpus.db)
    → Synthesise (deep profiles, structured fields)
      → Embed (text-embedding-3-small, 1536 dims)
        → Push to Supabase (14b, 14c, 14-push-capital-app.py)
          → App reads via queries (match-score.ts, investor-profile.ts)
```

**Supabase project:** `kgkajatjyqfetdtbzmwg` (apex-outreach)

## What the app reads and how

### Matching engine (`lib/queries/match-score.ts`)

Two-stage pipeline:

1. **Candidate retrieval** — calls `match_investors_by_embedding` RPC with the founder's hero text embedded via OpenAI `text-embedding-3-small` at 1536 dimensions. Returns top ~200 investors by cosine distance from `investors_mirror.embedding vector(1536)`. Falls back to freshness-sorted top 2,000 if `OPENAI_API_KEY` is absent (it IS set in Vercel prod).

2. **Re-ranking** — `scoreDims()` scores each candidate across 7 dimensions:
   - Thesis (Jaccard of hero text tokens against `thesis_summary` + `sector_focus` + `ideal_company_profile`)
   - Stage match (`stage_focus`)
   - Geo match (`geo_focus` + `hq_location`)
   - Cheque fit (`cheque_min_usd`, `cheque_max_usd`)
   - Activity (freshness of `synthesized_at` / `last_enriched`)
   - Data quality (`data_quality_score`)
   - Hardware fit (`hardware_fit_score`, weighted 15%, non-penalising when null)

### Investor profile page (`lib/queries/investor-profile.ts`)

Reads from two tables:
- `investors_mirror` — structured fields (thesis, sector, stage, geo, cheque, fund size, etc.)
- `investor_deep_profiles` — `profile_json` JSONB with: `investment_thesis`, `recent_investments`, `recent_news`, `fund_details`, `team`, `sector_focus`, `stage_focus`, `geo_focus`, `tickets`, `quality_assessment`, `fact_checks`, `social_presence`, `sources`

Both are working end-to-end. 14,396 rows in `investors_mirror`, 8,227 in `investor_deep_profiles`.

## What's working

| Component | Status | Detail |
|---|---|---|
| Structured fields on `investors_mirror` | Live | 37 columns, 14,396 rows |
| Deep profiles | Live | 8,227 rows, rendered on profile page |
| Embedding column | Live | 14,393/14,396 rows have vectors |
| Embedding search RPC | Live | `match_investors_by_embedding(query_embedding, match_count)` |
| OpenAI API key | Set | Both prod and dev in Vercel env |
| `hardware_fit_score` in scoring | Live (just shipped) | 14,103 rows, weighted 15% |
| `ideal_company_profile` in scoring | Live (just shipped) | 5,744 rows, fed into thesis Jaccard bag |

## What's broken or missing

### 1. Raw scraped pages are not embedded (critical gap)

**The data exists:**
- `forge-capital.db → investor_raw_pages`: 49,418 pages from 7,555 investors
- `corpus.db → investor_raw_pages`: 260,465 pages from 8,362 investors
- `corpus.db → page_chunks`: 864,975 chunks (text is there, no embeddings)

**The embedding script (`18-build-embeddings.py`) only embeds synthesised summaries** — `firm_name` + `thesis_deep` (or fallback chain). The full page text is never embedded.

**What this means for matching quality:** The current embedding search matches the founder's pitch against a ~200-word synthesis per investor. If the full scraped content were embedded, we'd be matching against thousands of words of actual website content — portfolio pages, blog posts, team bios, thesis pages. An investor who wrote a blog post about backing a hardware company in exactly the founder's space would surface, even if their synthesis doesn't mention it.

### 2. Embedding dimension question

The `investors_mirror.embedding` column in Supabase is `vector(1536)` (OpenAI text-embedding-3-small). Confirmed working. But the push script `14b-push-embeddings-to-capital-app.py` was previously pushing 768-dim nomic embeddings. **Verify what's currently in the column** — if it's the older nomic vectors, re-push with the OpenAI 1536-dim vectors from SQLite `investor_embeddings`.

Quick check:
```sql
SELECT embedding <-> '[0,0,...,0]'::vector(1536) AS dist
FROM investors_mirror
WHERE embedding IS NOT NULL
LIMIT 1;
```
If this errors, the vectors aren't 1536-dim.

### 3. `synthesis_data` on `investors_mirror` is stored as scalar string

The column is `jsonb` but contains scalar strings, not JSON objects. `parsePortfolioCompanies()` in the app always returns `[]` because `jsonb_typeof(synthesis_data)` never returns `'object'`. Either fix the push script to store proper JSONB or the app will never extract portfolio companies from this field.

### 4. No raw pages table in forge-capital-app Supabase

`14e-push-investor-pages.py` pushes raw pages to the ForgeOS Supabase (`jyarhvinengfyrwgtskq`), NOT to the forge-capital-app project (`kgkajatjyqfetdtbzmwg`). If the app needs to search or display raw page content, a table needs to be created and the push script needs to target the right project.

## What the pipeline needs to deliver

For the app to use the full scraped content, the pipeline needs to:

### Option A: Chunk-level embeddings in a new Supabase table

1. **Embed the page chunks** — run `text-embedding-3-small` (1536 dims) over the 864,975 chunks in `corpus.db → page_chunks`
2. **Create a new Supabase table:**
   ```sql
   CREATE TABLE investor_page_chunks (
     id bigserial PRIMARY KEY,
     investor_id bigint REFERENCES investors_mirror(id),
     page_url text,
     chunk_index int,
     chunk_text text,
     embedding vector(1536),
     created_at timestamptz DEFAULT now()
   );
   CREATE INDEX ON investor_page_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 300);
   ```
3. **Push chunks + embeddings** to this table
4. **Create an RPC** for chunk-level search:
   ```sql
   CREATE FUNCTION match_investor_chunks(query_embedding vector(1536), match_count int)
   RETURNS TABLE (investor_id bigint, chunk_text text, page_url text, cosine_distance float)
   AS $$ ... $$;
   ```

### Option B: Per-investor concatenated embedding (simpler)

1. Concatenate all scraped page text per investor into one document
2. Re-embed the concatenated text (may need truncation to fit model context)
3. Push to the existing `investors_mirror.embedding` column, replacing the summary-only embedding
4. No schema changes needed — the app's existing `match_investors_by_embedding` RPC works as-is

**Option A is more powerful** (you can show which specific page/paragraph matched) but requires more infrastructure. **Option B is a quick win** that immediately improves match quality with zero app changes.

### Either way, also fix:

- Re-push 1536-dim OpenAI embeddings if the column currently has 768-dim nomic vectors
- Fix `synthesis_data` to store proper JSONB objects, not scalar strings
- Consider pushing `investor_raw_pages` to the forge-capital-app Supabase for full-text display

## App-side contact points

The app code that would need changes if new tables/RPCs are added:

- `lib/queries/match-score.ts` — candidate retrieval, would call a new chunk-search RPC
- `lib/queries/investor-profile.ts` — would query chunk table for profile page display
- `app/(authed)/investor/[id]/InvestorProfileView.tsx` — would render matched excerpts
- `app/(authed)/match/FindAMatch.tsx` — could show "matched because of [excerpt from blog post]"
- `lib/embeddings/openai.ts` — the embedding helper, already wired for `text-embedding-3-small` at 1536 dims

## Files in this repo that matter

```
lib/queries/match-score.ts          — scoring engine + embedding search
lib/queries/match-score-types.ts    — MatchResultRow interface
lib/queries/investor-profile.ts     — profile page data loader
lib/embeddings/openai.ts            — OpenAI embedding helper
app/(authed)/match/FindAMatch.tsx   — match UI (cards, drill-down)
app/(authed)/investor/[id]/InvestorProfileView.tsx — full profile page
app/(authed)/match/match-v4-actions.ts — server actions (insight generation)
```
