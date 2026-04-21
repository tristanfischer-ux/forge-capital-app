-- 007_rls.sql
-- V1 RLS — Tristan-only. Every table above is gated on the authenticated
-- user's email matching tristan.fischer@gmail.com.
--
-- This is temporary. Phase 5-6 replaces these with proper multi-tenant
-- policies: counterpart approvers (Stephan, Chris Kirke, Andrew) get scoped
-- read/write against the specific campaign_partners rows they approve; the
-- advisor (Tristan) keeps full access; the service-role key (used by the
-- nightly sync) bypasses RLS anyway.
--
-- When that lands, this migration is superseded by a later one that drops
-- these policies and adds role-based + per-campaign-membership policies.

alter table public.campaigns           enable row level security;
alter table public.investors_mirror    enable row level security;
alter table public.partners_mirror     enable row level security;
alter table public.campaign_partners   enable row level security;
alter table public.contact_events      enable row level security;
alter table public.email_templates     enable row level security;

-- Helper: we create one policy per table, ALL-actions, matching the JWT email.
-- `auth.jwt()->>'email'` is the documented Supabase pattern for the signed-in user's email.

do $$
declare
  tbl text;
begin
  for tbl in
    select unnest(array[
      'campaigns',
      'investors_mirror',
      'partners_mirror',
      'campaign_partners',
      'contact_events',
      'email_templates'
    ])
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      tbl || '_tristan_only',
      tbl
    );
    execute format(
      'create policy %I on public.%I for all to authenticated using ((auth.jwt() ->> ''email'') = ''tristan.fischer@gmail.com'') with check ((auth.jwt() ->> ''email'') = ''tristan.fischer@gmail.com'')',
      tbl || '_tristan_only',
      tbl
    );
  end loop;
end $$;

comment on policy campaigns_tristan_only           on public.campaigns           is 'V1 only. Replaced in Phase 5 by role-based policies.';
comment on policy investors_mirror_tristan_only    on public.investors_mirror    is 'V1 only. Replaced in Phase 5 by role-based policies.';
comment on policy partners_mirror_tristan_only     on public.partners_mirror     is 'V1 only. Replaced in Phase 5 by role-based policies.';
comment on policy campaign_partners_tristan_only   on public.campaign_partners   is 'V1 only. Replaced in Phase 5 by role-based policies.';
comment on policy contact_events_tristan_only      on public.contact_events      is 'V1 only. Replaced in Phase 5 by role-based policies.';
comment on policy email_templates_tristan_only     on public.email_templates     is 'V1 only. Replaced in Phase 5 by role-based policies.';
