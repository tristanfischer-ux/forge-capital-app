-- 013_email_hunt_workflow.sql
-- Adds two tables behind the Find-a-Match "Resolve email →" chip (#69):
--
--   partner_email_overrides
--     User-provided manual email resolution. The user attests they know
--     the correct email (usually from a referral, prior correspondence,
--     a LinkedIn lookup). Takes precedence over partners_mirror.email
--     until cleared or the nightly pipeline overwrites via explicit
--     confirmation.
--
--   partner_email_hunt_requests
--     Work queue the nightly Forge Capital pipeline reads to prioritise
--     which partners to run through Hunter email-finder next run. The
--     pipeline marks them resolved when it writes back to partners_mirror.
--
-- Both are scoped by `created_by` and RLS'd so multi-user campaigns stay
-- tenant-isolated (same pattern as 011_multi_user_rls.sql).

create table if not exists public.partner_email_overrides (
  partner_id        bigint primary key references public.partners_mirror(id) on delete cascade,
  email             text not null,
  email_tier        text not null default 'hunter_verified'
                      check (email_tier in ('corresponded','hunter_verified','unverified')),
  source_note       text,
  created_by        uuid not null references auth.users(id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists partner_email_overrides_created_by_idx
  on public.partner_email_overrides (created_by);

comment on table public.partner_email_overrides is
  'User-provided email for a partner when the nightly pipeline has not yet verified one. Read-side queries treat an override as the effective email until cleared.';

create table if not exists public.partner_email_hunt_requests (
  id                uuid primary key default gen_random_uuid(),
  partner_id        bigint not null references public.partners_mirror(id) on delete cascade,
  requested_by      uuid not null references auth.users(id) on delete cascade,
  requested_at      timestamptz not null default now(),
  notes             text,
  status            text not null default 'pending'
                      check (status in ('pending','processing','resolved','failed')),
  resolved_at       timestamptz,
  resolution_note   text
);

create index if not exists partner_email_hunt_requests_partner_idx
  on public.partner_email_hunt_requests (partner_id);
create index if not exists partner_email_hunt_requests_status_idx
  on public.partner_email_hunt_requests (status);
create index if not exists partner_email_hunt_requests_requested_by_idx
  on public.partner_email_hunt_requests (requested_by);

comment on table public.partner_email_hunt_requests is
  'Queue of partners the user wants the nightly Hunter pipeline to prioritise. Pipeline reads status=pending, writes resolved + fills partners_mirror.email_tier.';

-- RLS: mirror the multi-user pattern. A user can manage their own
-- overrides + requests. Service role bypasses RLS for the pipeline.
alter table public.partner_email_overrides    enable row level security;
alter table public.partner_email_hunt_requests enable row level security;

drop policy if exists partner_email_overrides_owner on public.partner_email_overrides;
create policy partner_email_overrides_owner
  on public.partner_email_overrides for all to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists partner_email_hunt_requests_owner on public.partner_email_hunt_requests;
create policy partner_email_hunt_requests_owner
  on public.partner_email_hunt_requests for all to authenticated
  using (requested_by = auth.uid())
  with check (requested_by = auth.uid());

-- updated_at trigger for partner_email_overrides.
create or replace function public.set_partner_email_overrides_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists partner_email_overrides_set_updated_at on public.partner_email_overrides;
create trigger partner_email_overrides_set_updated_at
  before update on public.partner_email_overrides
  for each row execute function public.set_partner_email_overrides_updated_at();
