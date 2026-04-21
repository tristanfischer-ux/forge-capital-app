-- seed/approvers.sql — per-campaign approver grants
--
-- Phase 5 RLS (migration 011_multi_user_rls) lets an approver see a
-- campaign iff there's a row in public.campaign_approvers matching
-- (campaign_id, email). This file lists the real grants.
--
-- How to add an approver:
--   1. Uncomment the line for the campaign they're approving.
--   2. Replace the placeholder email with their real address (Gmail or
--      whichever inbox they'll reply from — RLS matches on the JWT
--      email, so it MUST match the address they sign into Supabase
--      with).
--   3. Run: `supabase db execute --file seed/approvers.sql` or paste
--      into the SQL editor at
--      https://supabase.com/dashboard/project/kgkajatjyqfetdtbzmwg/sql/new
--   4. Have the approver request a magic link at forge-capital-app.vercel.app
--      — they'll see their assigned campaign and nothing else.
--
-- Removing an approver: `delete from public.campaign_approvers where email = '...'`
--
-- Campaign IDs below are canonical as of 2026-04-22. If they change,
-- `select id, name from public.campaigns order by name;` always tells
-- you the current values.

-- ── SkySails Power ──────────────────────────────────────────────────
-- insert into public.campaign_approvers (campaign_id, email, role, added_by) values
--   ('bc1f183c-e4bb-4036-b596-1a550d3318cb', 'stephan.wrage@skysails-group.com', 'approver', 'tristan.fischer@gmail.com')
--   on conflict (campaign_id, email) do nothing;

-- ── FishFrom Technologies ──────────────────────────────────────────
-- insert into public.campaign_approvers (campaign_id, email, role, added_by) values
--   ('b3a29688-3b74-4d03-ac21-1d6ad22e8ad9', 'stephan.wrage@skysails-group.com', 'approver', 'tristan.fischer@gmail.com')
--   on conflict (campaign_id, email) do nothing;

-- ── Panatere ────────────────────────────────────────────────────────
-- insert into public.campaign_approvers (campaign_id, email, role, added_by) values
--   ('03d87e25-492d-4b68-a2d1-76df814ccd7e', 'olivier.dematter@panatere.com', 'approver', 'tristan.fischer@gmail.com')
--   on conflict (campaign_id, email) do nothing;

-- ── ForgeOS ─────────────────────────────────────────────────────────
-- insert into public.campaign_approvers (campaign_id, email, role, added_by) values
--   ('72ae7a6a-95a6-455b-b3b0-ed8e609a2271', 'PLACEHOLDER@forgeos.ai', 'approver', 'tristan.fischer@gmail.com')
--   on conflict (campaign_id, email) do nothing;

-- ── Fischer Farms Customer (programme starts July 2026) ────────────
-- insert into public.campaign_approvers (campaign_id, email, role, added_by) values
--   ('65e31c4d-ef93-4d3d-b51f-1bcedb25cc9f', 'PLACEHOLDER@fischerfarms.co.uk', 'approver', 'tristan.fischer@gmail.com')
--   on conflict (campaign_id, email) do nothing;
