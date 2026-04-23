-- 024_contact_events_crm_extension.sql
--
-- CRM extension for contact_events — log calls, meetings, LinkedIn
-- messages, personal notes alongside the existing email touchpoints.
--
-- Per Tristan 2026-04-23: "I frequently record a call using Wispr
-- and paste the transcript into the box. Once I paste, it would be
-- very useful for that information to be synthesised and come up with
-- a series of actions and items on the back of that."

alter table public.contact_events
  add column if not exists title text,
  add column if not exists notes text,
  add column if not exists duration_minutes integer,
  add column if not exists follow_up_due_at timestamptz,
  add column if not exists follow_up_done_at timestamptz,
  add column if not exists synthesised_actions jsonb,
  add column if not exists google_calendar_event_id text;

alter table public.contact_events
  drop constraint if exists contact_events_channel_check;

alter table public.contact_events
  add constraint contact_events_channel_check
  check (channel in (
    'gmail', 'linkedin', 'phone', 'meeting', 'manual',
    'call', 'zoom', 'google_meet', 'teams', 'in_person',
    'whatsapp', 'signal', 'slack'
  ));

alter table public.contact_events
  drop constraint if exists contact_events_direction_check;

alter table public.contact_events
  add constraint contact_events_direction_check
  check (direction is null or direction in (
    'outbound', 'inbound', 'bounce', 'auto_reply', 'manual',
    'note', 'meeting'
  ));

create index if not exists contact_events_followup_due_idx
  on public.contact_events (follow_up_due_at)
  where follow_up_due_at is not null and follow_up_done_at is null;

create unique index if not exists contact_events_gcal_unique_idx
  on public.contact_events (google_calendar_event_id)
  where google_calendar_event_id is not null;

comment on column public.contact_events.title is
  'Short title for non-email events — "Intro call with Marianne", "Coffee at Station F". Email events leave this null and use summary instead.';
comment on column public.contact_events.notes is
  'Long-form notes. Calls frequently get a paste of the Wispr transcript here; synthesised_actions is Opus-extracted from this field.';
comment on column public.contact_events.duration_minutes is
  'For calls / meetings. Informs engagement scoring later.';
comment on column public.contact_events.follow_up_due_at is
  'When Tristan should re-touch this partner. Surfaced on /follow-ups.';
comment on column public.contact_events.follow_up_done_at is
  'Stamped when the follow-up is either completed (via logging a new interaction) or explicitly marked done.';
comment on column public.contact_events.synthesised_actions is
  'JSON from Opus: {summary: [], action_items: [{text, owner, due_at_guess}], intel: [], quotes: [], suggested_status: "+N" | null, suggested_follow_up_due_at: ISO | null}';
comment on column public.contact_events.google_calendar_event_id is
  'When this row was auto-ingested from Google Calendar, the event id. Unique-indexed so ingest reruns are idempotent.';
