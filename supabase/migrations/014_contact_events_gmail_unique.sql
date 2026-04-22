-- 014_contact_events_gmail_unique.sql
-- Prepare contact_events and gmail_tokens for the Phase 8 Gmail inbound sync
-- daemon (scripts/gmail-sync.mjs, launchd every 15 min). The daemon upserts
-- a row per Gmail message id, so we need a unique constraint. We also track
-- per-user sync cursor + status on gmail_tokens.
--
-- gmail_message_id is nullable (manual / linkedin / phone rows do not have
-- one). A partial unique index is the right shape — enforce uniqueness only
-- where the value is present.

create unique index if not exists contact_events_gmail_message_id_uniq
  on public.contact_events (gmail_message_id)
  where gmail_message_id is not null;

create index if not exists contact_events_direction_idx
  on public.contact_events (direction);

alter table public.gmail_tokens
  add column if not exists last_gmail_sync_at timestamptz;

alter table public.gmail_tokens
  add column if not exists last_gmail_sync_status text;

alter table public.gmail_tokens
  add column if not exists last_gmail_sync_error text;

comment on column public.gmail_tokens.last_gmail_sync_at is
  'Phase 8: incremental sync cursor — scripts/gmail-sync.mjs queries Gmail for messages after this timestamp on each run.';
comment on column public.gmail_tokens.last_gmail_sync_status is
  'Phase 8: "ok" | "partial" | "scope_insufficient" | "refresh_failed".';

notify pgrst, 'reload schema';
