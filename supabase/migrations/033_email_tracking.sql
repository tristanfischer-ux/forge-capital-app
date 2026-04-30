-- 033_email_tracking.sql
--
-- Adds metadata column to contact_events to store tracking data
-- (open pixel tracking, click tracking, follow-up suggestion metadata).
-- event_type is free text (per migration 005 comment) so no constraint changes needed.
-- The new tracking event types are:
--   email_opened        — pixel fired from recipient's email client
--   link_clicked        — tracked link clicked
--   follow_up_suggested — cron flagged this partner for follow-up review
--
-- We also add a tracking_metadata jsonb column to store structured data
-- alongside tracking events (e.g. user-agent, IP geo, original URL clicked).

alter table public.contact_events
  add column if not exists tracking_metadata jsonb;

comment on column public.contact_events.tracking_metadata is
  'Structured data for tracking events. email_opened: {user_agent, ip}. link_clicked: {original_url, user_agent, ip}. follow_up_suggested: {sent_at, opened_at, days_since_open}.';

-- Index for efficiently querying open/click events per partner
create index if not exists contact_events_event_type_idx
  on public.contact_events (campaign_partner_id, event_type)
  where event_type is not null;
