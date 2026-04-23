-- 019_match_investors_bump_hnsw_ef_search.sql
--
-- AUDIT FINDING 2026-04-23 (Wren Aerospace walkthrough):
-- match_investors_by_embedding asked for 500 candidates but the RPC
-- returned only 40 — pgvector HNSW's `ef_search` GUC defaults to 40,
-- which silently caps every ANN query at 40 results regardless of the
-- LIMIT clause. For Wren ("high-altitude drone"), 21 of those 40 were
-- aerospace investors (good), but the next ~700 sector-relevant rows in
-- the database never got considered.
--
-- Fix: set ef_search inside the function to roughly 2× match_count
-- (HNSW recommends ef_search >= LIMIT for full results). Use a
-- `SET LOCAL` so the change scopes to the function call only and
-- doesn't leak to the calling transaction.
--
-- Performance trade-off: each query does a wider HNSW walk. For 500
-- LIMIT, ef_search=1000 still finishes in <100ms on this index size
-- (8.7k rows). Acceptable.

create or replace function public.match_investors_by_embedding(
  query_embedding vector(768),
  match_count int default 500
)
returns table (
  id bigint,
  cosine_distance double precision
)
language plpgsql
stable
security invoker
as $$
begin
  perform set_config(
    'hnsw.ef_search',
    greatest(100, least(1000, match_count * 2))::text,
    true
  );
  return query
  select
    i.id,
    (i.embedding <=> query_embedding)::double precision as cosine_distance
  from public.investors_mirror i
  where i.actively_deploying = true
    and i.embedding is not null
  order by i.embedding <=> query_embedding
  limit match_count;
end;
$$;

comment on function public.match_investors_by_embedding(vector, int) is
  'ANN candidate retriever. Sets hnsw.ef_search = 2*match_count locally so HNSW walks wide enough (default ef_search=40 was silently capping all queries at 40 rows). Migration 019.';

grant execute on function public.match_investors_by_embedding(vector, int)
  to authenticated, service_role;
