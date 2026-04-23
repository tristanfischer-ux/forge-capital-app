-- 026_scheduled_sends.sql
--
-- Time-windowed batch sends (scheduled dispatch).
--
-- Tristan's Fischer Farms Nordics + Canada outreach needs to arrive
-- 6-7am local-recipient time rather than landing in Gmail in a single
-- burst. The `queueScheduledBatch` server action inserts a row here
-- per partner; the `scripts/scheduled-sends-dispatcher.mjs` daemon
-- polls every 60 seconds and dispatches rows whose
-- `scheduled_for_utc <= now()` via `sendGmailMessage` (same deliverability
-- pre-flight as the live send path).
--
-- State machine:
--   pending      → queued, waiting for scheduled_for_utc
--   dispatching  → daemon has claimed the row, Gmail call in flight
--   sent         → Gmail accepted; gmail_thread_id + gmail_message_id set
--   failed       → Gmail rejected OR deliverability check failed;
--                  error_message captures the text for the monitor UI
--   cancelled    → founder clicked Cancel in /approval/scheduled before
--                  the daemon picked it up
--
-- Design doc: docs/design-scheduled-sends.md.

create table if not exists public.scheduled_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_partner_id uuid not null
    references public.campaign_partners(id) on delete cascade,
  to_email text not null,
  subject text not null,
  body text not null,
  scheduled_for_utc timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending','dispatching','sent','failed','cancelled')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  sent_at timestamptz,
  error_message text,
  gmail_thread_id text,
  gmail_message_id text
);

-- Partial index on pending rows — the dispatcher polls every 60s and
-- only cares about pending rows whose scheduled_for_utc is due.
create index if not exists scheduled_sends_due_idx
  on public.scheduled_sends(scheduled_for_utc)
  where status = 'pending';

-- Lookup-by-partner index — the monitor UI groups by campaign and we
-- filter by campaign_partner_id → campaign join.
create index if not exists scheduled_sends_partner_idx
  on public.scheduled_sends(campaign_partner_id);

comment on table public.scheduled_sends is
  'Time-windowed batch dispatch queue. scripts/scheduled-sends-dispatcher.mjs polls pending rows whose scheduled_for_utc <= now() and sends via Gmail API. See docs/design-scheduled-sends.md.';

-- ── RLS ─────────────────────────────────────────────────────────────
-- Founder-only (same pattern as contact_events — not exposed to
-- approvers). Writes go through the server action (founder-authed)
-- and the daemon (service-role). No policy for approvers.

alter table public.scheduled_sends enable row level security;

drop policy if exists scheduled_sends_founders_all on public.scheduled_sends;
create policy scheduled_sends_founders_all
  on public.scheduled_sends for all to authenticated
  using (public.is_founder())
  with check (public.is_founder());
