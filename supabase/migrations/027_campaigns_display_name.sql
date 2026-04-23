-- 027_campaigns_display_name.sql
--
-- UX audit 2026-04-23 item #2: the internal `campaigns.name` value bleeds
-- into real user-facing strings. "AUDIT · Wren Aerospace · Investor" is a
-- tracker/audit tag, not a label anyone outside Tristan should ever see —
-- but it currently shows up in outbound email subjects, the approval sheet
-- filename, the weekly counterpart update header, and the
-- `[APPROVAL] … ` email-list subject.
--
-- This migration introduces a dedicated `display_name` column on
-- `campaigns`. `name` stays as the auditable internal token (so existing
-- tracker imports and SQLite→Supabase sync scripts keep working untouched).
-- `display_name` is what the UI renders in every founder/counterpart-facing
-- surface via the `displayNameFor(campaign)` helper in
-- `lib/queries/campaigns.ts` — falling back to `name` when unset so no
-- surface breaks during rollout.
--
-- Null is the safe default: rows without an explicit display_name resolve
-- to `name` at read time. Backfill of the existing five campaigns happens
-- in the deploy step that follows this migration (see the task brief).

alter table public.campaigns
  add column if not exists display_name text;

comment on column public.campaigns.display_name is
  'User-facing campaign label used in email subjects, approval sheet titles, and weekly digest headers. Falls back to campaigns.name at read time. Set per campaign to prevent internal tracker tokens ("AUDIT · …") leaking into real correspondence.';
