-- 011_multi_user_rls.sql
-- Phase 5 — Multi-user RLS. Supersedes 007's email-only Tristan gate.
--
-- Model:
--   - FOUNDER (Tristan) — full read/write on everything. Identified by
--     auth.jwt()->>'email' in `public.platform_founders` (table, not
--     hardcoded, so future co-founders can be added without a migration).
--   - APPROVERS (Stephan, Chris Kirke, Andrew, Olivier, …) — scoped
--     SELECT on campaigns they approve, via `public.campaign_approvers`
--     (email ↔ campaign_id, many-to-many).
--
--   Approvers are intentionally SELECT-only at the RLS layer. Writes
--   from approvers flow through the 16-parse-approval-replies.py script
--   which uses the service-role key (bypasses RLS). This keeps the
--   "Gmail is authoritative" invariant — approvers reply by email, not
--   by clicking in the web app. If a Phase 5.1 web approve-button lands
--   later, a separate migration will widen UPDATE scope with
--   column-level restrictions.
--
-- Migration safety:
--   - Drops V1 _tristan_only policies via the same DO block used to
--     create them in 007 (name-based drop, idempotent).
--   - Inserts the canonical founder row inside the same transaction,
--     so at no point is there a window with zero permissive policies.
--   - If you apply this migration before seeding approvers, you'll
--     have a working founder session and zero approver sessions — which
--     is exactly the pre-Phase-5 state, so no one gets locked out.
--
-- Transaction note: no explicit BEGIN/COMMIT. Supabase's migration
-- runner wraps the file in a transaction already. Adding another one
-- would fire a nested-txn warning or (worse) close the outer txn early.

-- ── Founder registry ────────────────────────────────────────────────────

create table if not exists public.platform_founders (
  email       text primary key,
  display_name text not null,
  added_at    timestamptz not null default now()
);

comment on table public.platform_founders is
  'Emails with full-access RLS. Bootstrapped with tristan.fischer@gmail.com. '
  'A new co-founder is added by inserting a row here; no migration needed.';

insert into public.platform_founders (email, display_name)
values ('tristan.fischer@gmail.com', 'Tristan Fischer')
on conflict (email) do nothing;

-- ── Campaign approvers registry ────────────────────────────────────────

create table if not exists public.campaign_approvers (
  id          bigserial primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  email       text not null,
  role        text not null default 'approver'
                check (role in ('approver','observer')),
  added_at    timestamptz not null default now(),
  added_by    text,
  unique (campaign_id, email)
);

create index if not exists campaign_approvers_email_idx
  on public.campaign_approvers (email);
create index if not exists campaign_approvers_campaign_id_idx
  on public.campaign_approvers (campaign_id);

comment on table public.campaign_approvers is
  'Per-campaign read-access grants. Insert (campaign_id, approver_email) '
  'to let an approver see that campaign. Approvers cannot write via RLS; '
  'writes flow through the service-role approval-reply parser.';
comment on column public.campaign_approvers.role is
  'approver — may be asked for decisions; observer — read-only, no prompts.';

alter table public.platform_founders    enable row level security;
alter table public.campaign_approvers   enable row level security;

-- Founders table: readable by anyone authenticated (so the app can
-- check its own role), writable only by service-role. No
-- authenticated-user write policy at all.
drop policy if exists platform_founders_read on public.platform_founders;
create policy platform_founders_read
  on public.platform_founders
  for select
  to authenticated
  using (true);

-- Approvers table: readable by founders + by the approver themselves
-- (for the "which campaigns do I have access to?" sidebar).
-- Writable by founders only.
drop policy if exists campaign_approvers_read on public.campaign_approvers;
create policy campaign_approvers_read
  on public.campaign_approvers
  for select
  to authenticated
  using (
    exists (
      select 1 from public.platform_founders
      where email = (auth.jwt() ->> 'email')
    )
    or email = (auth.jwt() ->> 'email')
  );

drop policy if exists campaign_approvers_write on public.campaign_approvers;
create policy campaign_approvers_write
  on public.campaign_approvers
  for all
  to authenticated
  using (
    exists (
      select 1 from public.platform_founders
      where email = (auth.jwt() ->> 'email')
    )
  )
  with check (
    exists (
      select 1 from public.platform_founders
      where email = (auth.jwt() ->> 'email')
    )
  );

-- ── Helper functions ──────────────────────────────────────────────────
-- Stable, security-invoker. Called from every RLS policy below.

create or replace function public.is_founder() returns boolean
language sql stable security invoker as $$
  select exists (
    select 1 from public.platform_founders
    where email = (auth.jwt() ->> 'email')
  );
$$;

create or replace function public.can_view_campaign(p_campaign_id uuid)
returns boolean
language sql stable security invoker as $$
  select public.is_founder() or exists (
    select 1 from public.campaign_approvers
    where campaign_id = p_campaign_id
      and email = (auth.jwt() ->> 'email')
  );
$$;

comment on function public.is_founder() is
  'True if the current JWT email is in platform_founders. Used by RLS.';
comment on function public.can_view_campaign(uuid) is
  'True if founder OR an approver for this specific campaign. Used by RLS.';

-- ── Drop V1 policies (created by 007_rls.sql) ─────────────────────────

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
  end loop;
end $$;

-- ── V2 policies per table ─────────────────────────────────────────────
--
-- Each table gets TWO policies:
--   * founders_all — founders see/write everything
--   * approvers_scoped — approvers see only what's in a campaign they approve
--
-- Tables the approver sees:
--   campaigns           — their campaigns only (for the sidebar)
--   campaign_partners   — tracker rows for their campaigns
--   partners_mirror     — partners that appear in their campaigns
--   investors_mirror    — investors that appear in their campaigns
--
-- Tables the approver does NOT see (founders-only):
--   contact_events      — full send history is sensitive
--   email_templates     — draft templates are not share-out material
--
-- All approver policies are SELECT-only. No UPDATE/INSERT/DELETE for
-- approvers. Writes flow through the service-role approval parser.

-- campaigns
drop policy if exists campaigns_founders_all on public.campaigns;
create policy campaigns_founders_all
  on public.campaigns for all to authenticated
  using (public.is_founder())
  with check (public.is_founder());

drop policy if exists campaigns_approvers_scoped on public.campaigns;
create policy campaigns_approvers_scoped
  on public.campaigns for select to authenticated
  using (public.can_view_campaign(id));

-- campaign_partners
drop policy if exists campaign_partners_founders_all on public.campaign_partners;
create policy campaign_partners_founders_all
  on public.campaign_partners for all to authenticated
  using (public.is_founder())
  with check (public.is_founder());

drop policy if exists campaign_partners_approvers_scoped on public.campaign_partners;
create policy campaign_partners_approvers_scoped
  on public.campaign_partners for select to authenticated
  using (public.can_view_campaign(campaign_id));

-- partners_mirror — approvers see partners that are in their campaigns
drop policy if exists partners_mirror_founders_all on public.partners_mirror;
create policy partners_mirror_founders_all
  on public.partners_mirror for all to authenticated
  using (public.is_founder())
  with check (public.is_founder());

drop policy if exists partners_mirror_approvers_scoped on public.partners_mirror;
create policy partners_mirror_approvers_scoped
  on public.partners_mirror for select to authenticated
  using (
    public.is_founder()
    or exists (
      select 1 from public.campaign_partners cp
      where cp.partner_id = partners_mirror.id
        and public.can_view_campaign(cp.campaign_id)
    )
  );

-- investors_mirror — approvers see investors that are in their campaigns
drop policy if exists investors_mirror_founders_all on public.investors_mirror;
create policy investors_mirror_founders_all
  on public.investors_mirror for all to authenticated
  using (public.is_founder())
  with check (public.is_founder());

drop policy if exists investors_mirror_approvers_scoped on public.investors_mirror;
create policy investors_mirror_approvers_scoped
  on public.investors_mirror for select to authenticated
  using (
    public.is_founder()
    or exists (
      select 1 from public.partners_mirror pm
      join public.campaign_partners cp on cp.partner_id = pm.id
      where pm.investor_id = investors_mirror.id
        and public.can_view_campaign(cp.campaign_id)
    )
  );

-- contact_events — founders only
drop policy if exists contact_events_founders_all on public.contact_events;
create policy contact_events_founders_all
  on public.contact_events for all to authenticated
  using (public.is_founder())
  with check (public.is_founder());

-- email_templates — founders only
drop policy if exists email_templates_founders_all on public.email_templates;
create policy email_templates_founders_all
  on public.email_templates for all to authenticated
  using (public.is_founder())
  with check (public.is_founder());

-- ── Comments summarising the policy surface ──────────────────────────

comment on policy campaigns_founders_all            on public.campaigns           is 'Founders (platform_founders) have unrestricted read/write.';
comment on policy campaigns_approvers_scoped        on public.campaigns           is 'Approvers read only campaigns where they have a campaign_approvers row.';
comment on policy campaign_partners_founders_all    on public.campaign_partners   is 'Founders have unrestricted read/write.';
comment on policy campaign_partners_approvers_scoped on public.campaign_partners  is 'Approvers read tracker rows only for their approved campaigns.';
comment on policy partners_mirror_founders_all      on public.partners_mirror     is 'Founders have unrestricted read/write.';
comment on policy partners_mirror_approvers_scoped  on public.partners_mirror     is 'Approvers read partners that appear in their approved campaigns.';
comment on policy investors_mirror_founders_all     on public.investors_mirror    is 'Founders have unrestricted read/write.';
comment on policy investors_mirror_approvers_scoped on public.investors_mirror    is 'Approvers read investors that appear (via partners) in their approved campaigns.';
comment on policy contact_events_founders_all       on public.contact_events      is 'Founders-only. Approvers never see raw send history.';
comment on policy email_templates_founders_all      on public.email_templates     is 'Founders-only. Templates are not shared with approvers.';
