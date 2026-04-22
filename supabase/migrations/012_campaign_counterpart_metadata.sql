-- 012_campaign_counterpart_metadata.sql
-- Adds per-campaign counterpart metadata so every section that used to
-- hardcode "Stephan" (from the V4 mockup's demo data) can render the real
-- counterpart for the active campaign. Editable in-app via the campaign
-- switcher's pencil button (no migration required to change a name).
--
-- New columns on public.campaigns:
--   counterpart_name        — display name shown on approval artefact,
--                             weekly update "To:", tracker subtitle.
--   counterpart_email       — email address used by the weekly composer
--                             when creating the Gmail draft. Nullable —
--                             empty state reads "counterpart TBD".
--   counterpart_role        — free text descriptor, e.g. "investor approver",
--                             "customer lead", "supplier contact".
--   week_started_at         — date the campaign's week-counter starts
--                             from. The weekly update subject shows
--                             "Week N of M" where N is weeks since this
--                             date; M is `week_count_target`.
--   week_count_target       — planned campaign length in weeks. V4's
--                             hardcoded "week 1 of 16" came from nowhere;
--                             now it's per-campaign. Default 16 so the
--                             existing UI doesn't change when empty.

alter table public.campaigns
  add column if not exists counterpart_name  text,
  add column if not exists counterpart_email text,
  add column if not exists counterpart_role  text,
  add column if not exists week_started_at   date,
  add column if not exists week_count_target int default 16;

comment on column public.campaigns.counterpart_name is
  'Real approver display name. Replaces every hardcoded "Stephan" from the V4 mockup demo data.';
comment on column public.campaigns.counterpart_email is
  'Real approver email. Used by the weekly composer + approval sheet.';
comment on column public.campaigns.counterpart_role is
  'Free text descriptor — "investor approver", "customer lead", etc.';
comment on column public.campaigns.week_started_at is
  'Date the campaign week-counter starts from. Weekly subject shows weeks-since-this.';
comment on column public.campaigns.week_count_target is
  'Planned length in weeks. Subject reads "Week N of week_count_target".';
