-- 003_partners_mirror.sql
-- Read-mostly mirror of Forge Capital `investor_partners`. Same sync cadence
-- as investors_mirror. Critically includes `email_tier` (the 5-tier
-- deliverability taxonomy from V4-FEEDBACK-ROUND-2.md §"Verification tiers")
-- and `email_tier_at` for freshness.
--
-- The tier enum is enforced here:
--   corresponded      — we've exchanged mail with this address in Gmail
--   hunter_verified   — Hunter confidence >= 80 AND not generic
--   unverified        — never checked or inconclusive; CANNOT advance to +2
--   generic_blocked   — info@/contact@/team@/hello@ pattern; hard-blocked
--   bounced           — address has hard-bounced; hard-blocked

create table if not exists public.partners_mirror (
  id                    bigint primary key,
  investor_id           bigint not null references public.investors_mirror(id) on delete cascade,
  name                  text,
  title                 text,
  email                 text,
  email_tier            text check (email_tier in ('corresponded','hunter_verified','unverified','generic_blocked','bounced')),
  email_tier_at         timestamptz,
  linkedin              text,
  focus_areas           text,
  bio                   text,
  is_primary_contact    boolean,
  last_synced_at        timestamptz not null default now()
);

create index if not exists partners_mirror_investor_id_idx on public.partners_mirror (investor_id);
create index if not exists partners_mirror_email_idx on public.partners_mirror (email);
create index if not exists partners_mirror_email_tier_idx on public.partners_mirror (email_tier);

comment on table public.partners_mirror is 'Nightly mirror of Forge Capital `investor_partners`. Source of truth is the local SQLite.';
comment on column public.partners_mirror.email_tier is '5-tier deliverability taxonomy. Only corresponded + hunter_verified can advance to +2 Drafted.';
