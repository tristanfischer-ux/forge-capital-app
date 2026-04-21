-- 008_mirror_extra_columns.sql
-- Extend investors_mirror + partners_mirror to accept the full passthrough
-- column set from research/14-push-capital-app.py. The original 002/003
-- migrations picked a minimal set for MVP; this one widens to match the
-- source SQLite schema exactly, so the nightly sync can upsert every row
-- without PostgREST rejecting unknown columns. All new columns are
-- nullable — source rows may not have them populated.
--
-- Applied via MCP during initial project bring-up on 2026-04-21. This
-- file brings the filesystem migrations/ directory into line with the
-- actual database state.

alter table public.investors_mirror
  add column if not exists last_enriched         text,
  add column if not exists data_quality_score    numeric,
  add column if not exists ideal_company_profile text,
  add column if not exists value_add             text,
  add column if not exists recent_activity       text,
  add column if not exists linkedin_url          text,
  add column if not exists twitter_url           text,
  add column if not exists linkedin_description  text,
  add column if not exists twitter_bio           text,
  add column if not exists hardware_fit_score    numeric,
  add column if not exists url_status            text,
  add column if not exists thesis_accuracy       text,
  add column if not exists entity_type           text,
  add column if not exists official_name         text,
  add column if not exists synthesized_at        text;

alter table public.partners_mirror
  add column if not exists last_verified            text,
  add column if not exists twitter                  text,
  add column if not exists deep_bio                 text,
  add column if not exists email_guessed            boolean,
  add column if not exists email_source             text,
  add column if not exists email_verified           boolean,
  add column if not exists email_verified_at        text,
  add column if not exists email_verified_method    text,
  add column if not exists email_verifier_confidence numeric,
  add column if not exists email_previous           text;
