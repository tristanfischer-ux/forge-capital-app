-- 015_investors_mirror_embedding.sql
--
-- Add 768-dim pgvector column to investors_mirror so forge-capital-app can do
-- semantic search against the same nomic-embed-text vectors already generated
-- by the Forge Capital pipeline (research/18-build-embeddings.py).
--
-- Parity note: this deliberately uses 768-dim (nomic-embed-text) rather than
-- 1536-dim (OpenAI text-embedding-3-small) so the local SQLite source and
-- the mirror share a single vector space. Mixing models is a hard
-- incompatibility — see ~/Developer/Forge-Capital/CLAUDE.md "Embedding
-- dimension mismatch is a hard incompatibility".
--
-- Sync script: research/14b-push-embeddings-to-capital-app.py
-- Daily cron: ~/Library/LaunchAgents/com.forgecapital.push-embeddings.plist

create extension if not exists vector;

alter table public.investors_mirror
  add column if not exists embedding vector(768);

create index if not exists investors_mirror_embedding_idx
  on public.investors_mirror
  using hnsw (embedding vector_cosine_ops);

comment on column public.investors_mirror.embedding is
  '768-dim nomic-embed-text vector, nightly-synced from Forge Capital SQLite investor_embeddings. Keyed on id. NULL until the nightly push has run.';
