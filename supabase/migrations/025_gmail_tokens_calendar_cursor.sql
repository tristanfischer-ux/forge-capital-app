-- 025_gmail_tokens_calendar_cursor.sql
--
-- Per-user cursor for the Calendar ingest. Stores the timestamp of
-- the last successful sync so the next run only fetches deltas.
-- Matches the pattern already used for last_gmail_sync_at.
alter table public.gmail_tokens
  add column if not exists calendar_cursor timestamptz;

comment on column public.gmail_tokens.calendar_cursor is
  'ISO timestamp of the last successful calendar-sync.mjs run for this user. Cursor advances only when no events fail to ingest — a failing batch keeps the cursor so the next run retries.';
