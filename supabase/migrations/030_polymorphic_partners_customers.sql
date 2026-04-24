-- 030_polymorphic_partners_customers.sql
--
-- Option 2 (Tristan 2026-04-24): make partners_mirror polymorphic so
-- the same campaign_partners → partners_mirror plumbing can target
-- customer companies (Fischer Farms) as well as investor firms.
--
-- Design:
--   partners_mirror gains:
--     kind text NOT NULL        — 'investor' | 'customer'
--     customer_id bigint        — FK to customers_mirror(id), nullable
--     investor_id becomes       — nullable
--   CHECK:
--     (kind='investor' AND investor_id IS NOT NULL AND customer_id IS NULL)
--     OR (kind='customer' AND customer_id IS NOT NULL AND investor_id IS NULL)
--
-- Existing investor rows get backfilled kind='investor' in one shot.
--
-- customers_mirror shape deliberately NARROWER than investors_mirror.
-- Customer fields (retailer / grower / DTC / wholesaler) don't need
-- stage_focus / cheque_* / fund_size / hardware_fit_score / thesis_*.
-- Customer-specific columns added: channel, wave, pitch_hook,
-- expected_ebitda_gbp, synthesis_data.
--
-- Every downstream query that joins partners_mirror → investors_mirror
-- keeps working — the investor-typed rows still have investor_id set.
-- Queries that want customer rows have to join via customer_id + kind
-- guard. See lib/queries/* for the new customer-aware helpers.

-- ── customers_mirror ───────────────────────────────────────────────

create table if not exists public.customers_mirror (
  id bigserial primary key,
  firm_name text not null,
  official_name text,
  website text,
  country_iso text,           -- ISO-2: SE, DK, CA, US, DE, NL, FR, PL, ...
  hq_location text,
  type text,                  -- retailer / DIY / grower / DTC / grocery / wholesaler / florist / hypermarket / b2b
  channel text,               -- free-text channel descriptor: "DIY", "Grocery (Salling Group)", etc.
  wave text check (wave in ('1','2','3','niche') or wave is null),
  pitch_hook text,            -- free-text: "new regulation + local supply — EU 2026 residue ban"
  expected_ebitda_gbp integer,-- per-container EBITDA at this customer's wholesale price, £
  bio text,
  deep_bio text,
  synthesis_data jsonb,       -- per-prospect context for the drafter
  synthesis_confidence text,
  linkedin_url text,
  url_status text,
  chrome_verified boolean default false,
  last_synced_at timestamptz not null default now(),
  last_enriched text,
  embedding vector(1536)      -- OpenAI text-embedding-3-small, same space as investors_mirror
);

create index if not exists customers_mirror_firm_name_idx
  on public.customers_mirror using btree (firm_name);
create index if not exists customers_mirror_country_idx
  on public.customers_mirror using btree (country_iso);
create index if not exists customers_mirror_wave_idx
  on public.customers_mirror using btree (wave);

comment on table public.customers_mirror is
  'Customer-side counterpart to investors_mirror. Houses retailers, growers, DTC brands, grocery, DIY chains for customer-outreach campaigns (campaign_intent = customer). Added 2026-04-24 for the Fischer Farms Nordics/Canada/USA programme.';

-- ── partners_mirror polymorphism ───────────────────────────────────

-- Add the discriminator + the customer FK.
alter table public.partners_mirror
  add column if not exists kind text,
  add column if not exists customer_id bigint
    references public.customers_mirror(id) on delete cascade;

-- Backfill: every existing row is an investor partner.
update public.partners_mirror
   set kind = 'investor'
 where kind is null;

-- Now enforce kind + drop the investor_id NOT NULL constraint so
-- customer-typed rows can carry customer_id instead.
alter table public.partners_mirror
  alter column kind set not null,
  alter column investor_id drop not null;

-- Polymorphism CHECK: exactly one of (investor_id, customer_id) must
-- be set, matching kind. Drop-then-create in case a prior run left it.
alter table public.partners_mirror
  drop constraint if exists partners_mirror_kind_check;
alter table public.partners_mirror
  add constraint partners_mirror_kind_check check (
    (kind = 'investor' and investor_id is not null and customer_id is null)
    or
    (kind = 'customer' and customer_id is not null and investor_id is null)
  );

-- Kind-valid-values CHECK, separate so the error message is clear.
alter table public.partners_mirror
  drop constraint if exists partners_mirror_kind_values;
alter table public.partners_mirror
  add constraint partners_mirror_kind_values
  check (kind in ('investor', 'customer'));

create index if not exists partners_mirror_kind_idx
  on public.partners_mirror using btree (kind);
create index if not exists partners_mirror_customer_id_idx
  on public.partners_mirror using btree (customer_id);

comment on column public.partners_mirror.kind is
  'Partner discriminator: investor (investor_id set) or customer (customer_id set). Added 2026-04-24 for option 2 polymorphic partners.';
comment on column public.partners_mirror.customer_id is
  'FK to customers_mirror when kind = customer. Must be null for investor partners. Added 2026-04-24.';

-- ── RLS ────────────────────────────────────────────────────────────
-- customers_mirror inherits the same founder-only pattern as
-- investors_mirror. Approvers never see customer rows directly — they
-- see campaign_partners through the approval flow, same as investors.

alter table public.customers_mirror enable row level security;

drop policy if exists customers_mirror_founders_all on public.customers_mirror;
create policy customers_mirror_founders_all
  on public.customers_mirror for all to authenticated
  using (true) with check (true);
