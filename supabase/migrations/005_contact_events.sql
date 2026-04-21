-- 005_contact_events.sql
-- Every interaction: sent, inbound reply, bounce, auto-reply, manually logged.
-- The Gmail ingest runner (Phase 8) writes most rows here. `last_contact_at`
-- on campaign_partners is derived from max(event_at) per campaign_partner_id.
--
-- Non-email events (phone, LinkedIn paste, meeting) use direction='manual'
-- and channel in ('linkedin','phone','meeting','manual') with a free-text
-- summary. Per V4-FEEDBACK-ROUND-2.md §"Non-email updates".

create table if not exists public.contact_events (
  id                        uuid primary key default gen_random_uuid(),
  campaign_partner_id       uuid not null references public.campaign_partners(id) on delete cascade,
  direction                 text check (direction in ('outbound','inbound','bounce','auto_reply','manual')),
  channel                   text check (channel in ('gmail','linkedin','phone','meeting','manual')),
  gmail_thread_id           text,
  gmail_message_id          text,
  event_type                text,
  event_at                  timestamptz not null default now(),
  summary                   text
);

create index if not exists contact_events_campaign_partner_id_idx on public.contact_events (campaign_partner_id);
create index if not exists contact_events_gmail_thread_id_idx on public.contact_events (gmail_thread_id);
create index if not exists contact_events_event_at_idx on public.contact_events (event_at desc);

comment on table public.contact_events is 'Every interaction touching a (campaign, partner). Gmail ingest and manual-log forms both write here.';
comment on column public.contact_events.event_type is 'Free text: sent|reply|bounce|ooo|meeting_scheduled|meeting_held|manual_note|etc.';
