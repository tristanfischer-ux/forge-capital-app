-- 017_match_investors_by_embedding_rpc.sql
-- Postgres function exposing pgvector ANN search via Supabase RPC. The
-- function sits inside normal RLS (caller's session scopes it) so the
-- `investors_mirror_founders_all` policy still gates read access.
--
-- Called from lib/queries/match-score.ts as a candidate retriever — we
-- pull top N investors by cosine similarity to the query's nomic
-- embedding, then apply the existing lexical reranker over the top-N.
-- Keeps the surface output stable; just swaps the candidate set from
-- "recently synthesised" to "semantically similar to the pitch".

create or replace function public.match_investors_by_embedding(
  query_embedding vector(768),
  match_count int default 500
)
returns table (
  id bigint,
  cosine_distance double precision
)
language sql
stable
security invoker
as $$
  select
    i.id,
    (i.embedding <=> query_embedding)::double precision as cosine_distance
  from public.investors_mirror i
  where i.actively_deploying = true
    and i.embedding is not null
  order by i.embedding <=> query_embedding
  limit match_count;
$$;

comment on function public.match_investors_by_embedding(vector, int) is
  'ANN candidate retriever for Find-a-Match. Takes a nomic-embed-text 768-dim query vector + result count, returns top-N investor ids by cosine distance. RLS applies via security invoker.';

grant execute on function public.match_investors_by_embedding(vector, int)
  to authenticated, service_role;
