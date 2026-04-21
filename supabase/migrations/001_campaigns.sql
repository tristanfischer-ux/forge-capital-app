-- 001_campaigns.sql
-- One row per campaign: SkySails, FishFrom, Panatere, ForgeOS,
-- Fischer Farms Customer (from July). Campaigns are the "which workstream
-- is this outreach part of" dimension everything else hangs off.

create extension if not exists "pgcrypto";

create table if not exists public.campaigns (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null unique,
  campaign_intent       text not null check (campaign_intent in ('investor','customer','supplier')),
  company_description   text,
  raise_size            text,
  company_website       text,
  status                text not null default 'active',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz
);

create index if not exists campaigns_status_idx on public.campaigns (status);
create index if not exists campaigns_intent_idx on public.campaigns (campaign_intent);

comment on table public.campaigns is 'Outreach campaigns. One row per workstream (SkySails, FishFrom, etc.).';
comment on column public.campaigns.campaign_intent is 'investor | customer | supplier — drives which Supabase tables and which email voice.';
comment on column public.campaigns.raise_size is 'Free text (e.g. "£500K EIS seed"). Exact as-written in outreach.';
