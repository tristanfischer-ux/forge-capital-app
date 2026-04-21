-- 009_relax_numeric_columns_to_text.sql
-- Forge Capital's investors table stores cheque/fund ranges as free-text
-- ("~$4,320,000 (€4M total per startup)") because the human data is often
-- a range, a caveat, or mixed-currency. Relax these columns to text so
-- the sync doesn't reject valid source rows on 22P02 (invalid numeric).
-- Downstream numeric filtering (if wanted) parses at read time.
--
-- data_quality_score and hardware_fit_score stayed numeric in source FC
-- SQLite but can drift to freeform when the pipeline tries to annotate;
-- relaxing them keeps the sync robust to source-schema evolution.
--
-- Applied via MCP during initial project bring-up on 2026-04-21, after
-- the first live --live push hit 22P02 on a cheque_min_usd value.

alter table public.investors_mirror
  alter column cheque_min_usd        type text using cheque_min_usd::text,
  alter column cheque_max_usd        type text using cheque_max_usd::text,
  alter column fund_size_usd         type text using fund_size_usd::text,
  alter column data_quality_score    type text using data_quality_score::text,
  alter column hardware_fit_score    type text using hardware_fit_score::text;

alter table public.partners_mirror
  alter column email_verifier_confidence type text using email_verifier_confidence::text;

-- Make PostgREST re-read the schema so clients see the new types on next fetch.
notify pgrst, 'reload schema';
