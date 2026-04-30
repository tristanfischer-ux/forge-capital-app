-- 035_weekly_digest_log.sql
--
-- Log of weekly digest emails sent (both the Monday founder digest and
-- the Friday counterpart update). Separate from contact_events because
-- these are campaign-level operational events, not per-partner touchpoints.
--
-- Two sources write here:
--   1. sendWeeklyDigestToMe (app/(authed)/weekly-digest/actions.ts)
--   2. sendWeeklyDigestToCounterpart (app/(authed)/weekly/actions.ts)
--
-- The /weekly page queries this table to show the history section.
--
-- NOTE: applied to Supabase project kgkajatjyqfetdtbzmwg on 2026-04-30
-- as migration 034 (before the local numbering conflict was discovered).

create table if not exists public.weekly_digest_log (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references public.campaigns(id) on delete cascade,
  sent_at        timestamptz not null default now(),
  digest_type    text not null check (digest_type in ('founder_digest', 'counterpart_update')),
  to_email       text not null,
  subject        text not null,
  body_preview   text,
  gmail_message_id text,
  created_by     uuid references auth.users(id)
);

create index if not exists weekly_digest_log_campaign_idx
  on public.weekly_digest_log (campaign_id, sent_at desc);

comment on table public.weekly_digest_log is
  'Audit log of weekly digests sent — both founder digest (Monday) and counterpart update (Friday). Queried by the /weekly history section.';

alter table public.weekly_digest_log enable row level security;

drop policy if exists weekly_digest_log_founders_all on public.weekly_digest_log;
create policy weekly_digest_log_founders_all
  on public.weekly_digest_log for all to authenticated
  using (public.is_founder())
  with check (public.is_founder());
