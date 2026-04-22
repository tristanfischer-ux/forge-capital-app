-- 016_contact_events_gmail_message_unique_constraint.sql
-- Migration 014 used a PARTIAL unique index with `WHERE gmail_message_id IS NOT NULL`,
-- but PostgREST's `on_conflict=gmail_message_id` requires a real UNIQUE constraint
-- (or a non-partial unique index) — partial indexes are silently ignored by the
-- planner's conflict-resolution path, causing "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification" errors.
--
-- Postgres treats NULLs as distinct for unique constraints by default, so a
-- plain UNIQUE on a nullable column is safe — rows with NULL gmail_message_id
-- (manual / phone / linkedin events) never collide.

drop index if exists public.contact_events_gmail_message_id_uniq;

alter table public.contact_events
  add constraint contact_events_gmail_message_id_unique
  unique (gmail_message_id);
