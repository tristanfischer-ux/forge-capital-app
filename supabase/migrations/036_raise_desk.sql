-- 036_raise_desk.sql
-- Raise desk: review queue, contact policy, import provenance, audit,
-- and a scheduled_sends gate that also checks company permission +
-- person-global blocks. Does not weaken the +1/+2 approval rule.

alter table public.campaign_partners
  add column if not exists status_raw text,
  add column if not exists import_needs_review boolean not null default false,
  add column if not exists import_batch text;

create table if not exists public.contact_policy (
  id uuid primary key default gen_random_uuid(),
  partner_id bigint references public.partners_mirror(id) on delete cascade,
  investor_id bigint references public.investors_mirror(id) on delete cascade,
  channel text not null default 'any',
  kind text not null check (kind in ('block', 'low_priority')),
  source text not null,
  reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (partner_id is not null or investor_id is not null)
);

create index if not exists contact_policy_partner_idx
  on public.contact_policy (partner_id)
  where partner_id is not null;

create table if not exists public.import_review_queue (
  id uuid primary key default gen_random_uuid(),
  import_batch text not null,
  campaign_name text not null,
  firm_name text,
  contact_name text,
  email text,
  website text,
  status_raw text,
  commentary text,
  last_contact_at timestamptz,
  reason text not null,
  disposition text not null default 'unresolved'
    check (disposition in ('unresolved', 'matched', 'local_stub', 'excluded', 'waived')),
  created_at timestamptz not null default now()
);

create index if not exists import_review_unresolved_idx
  on public.import_review_queue (import_batch)
  where disposition = 'unresolved';

create table if not exists public.mutation_audit (
  id uuid primary key default gen_random_uuid(),
  actor text,
  table_name text not null,
  row_id text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

alter table public.contact_policy enable row level security;
alter table public.import_review_queue enable row level security;
alter table public.mutation_audit enable row level security;

drop policy if exists founders_all on public.contact_policy;
create policy founders_all on public.contact_policy
  for all
  using (exists (select 1 from public.platform_founders where email = auth.jwt() ->> 'email'))
  with check (exists (select 1 from public.platform_founders where email = auth.jwt() ->> 'email'));

drop policy if exists founders_all on public.import_review_queue;
create policy founders_all on public.import_review_queue
  for all
  using (exists (select 1 from public.platform_founders where email = auth.jwt() ->> 'email'))
  with check (exists (select 1 from public.platform_founders where email = auth.jwt() ->> 'email'));

drop policy if exists founders_all on public.mutation_audit;
create policy founders_all on public.mutation_audit
  for all
  using (exists (select 1 from public.platform_founders where email = auth.jwt() ->> 'email'))
  with check (exists (select 1 from public.platform_founders where email = auth.jwt() ->> 'email'));

-- Extend the send gate: still requires +1/+2, AND company permission,
-- AND no person-global block.
create or replace function public.enforce_scheduled_send_approval_gate()
returns trigger
language plpgsql
security definer
as $$
declare
  cp_status text;
  cp_perm text;
  cp_partner bigint;
  blocked int;
begin
  select status_code, permission_status, partner_id
    into cp_status, cp_perm, cp_partner
    from public.campaign_partners
   where id = new.campaign_partner_id;

  if cp_status is null then
    raise exception using
      errcode = 'P0001',
      message = format(
        'scheduled_sends insert rejected: campaign_partner %s not found',
        new.campaign_partner_id
      );
  end if;

  if cp_status not in ('+1', '+2') then
    raise exception using
      errcode = 'P0001',
      message = format(
        'scheduled_sends insert rejected: campaign_partner %s is at status_code %s, must be +1 or +2.',
        new.campaign_partner_id,
        cp_status
      );
  end if;

  if coalesce(cp_perm, 'not_required') not in ('approved', 'not_required') then
    raise exception using
      errcode = 'P0001',
      message = format(
        'scheduled_sends insert rejected: campaign_partner %s permission_status is %s.',
        new.campaign_partner_id,
        cp_perm
      );
  end if;

  select count(*) into blocked
    from public.contact_policy
   where kind = 'block'
     and partner_id = cp_partner
     and (expires_at is null or expires_at > now())
     and channel in ('any', 'gmail');

  if blocked > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'scheduled_sends insert rejected: partner on campaign_partner %s is blocked by contact_policy.',
        new.campaign_partner_id
      );
  end if;

  return new;
end;
$$;
