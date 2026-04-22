-- 018_portfolio_companies.sql
-- Portfolio-company index with de-duped canonical rows + investor junction.
--
-- The SQLite source (`portfolio_companies` in ~/.forge-capital/forge-capital.db)
-- holds one row per (investor, company) pair — 93k rows, 64k distinct names.
-- When the same portfolio company (e.g. "Ginkgo Bioworks") is backed by four
-- investors, the pipeline currently writes four separate rows. Mirroring that
-- shape would produce investor-side duplicates on every company profile page.
--
-- The mirror therefore splits responsibilities:
--   portfolio_companies        — one canonical row per company, keyed on
--                                slug (lowercased, hyphenated name). Holds
--                                display name, sector, stage, HQ, website.
--   investor_portfolio_links   — junction. One row per (investor_id,
--                                portfolio_company_id). Holds round, amount,
--                                round_at, source_url — everything that
--                                varies across investors backing the same
--                                company.
--
-- The pipeline sync (research/14c-push-portfolio-to-capital-app.py) merges
-- SQLite rows with the same slug into one `portfolio_companies` upsert and
-- writes one junction row per (investor, company) pair.
--
-- RLS mirrors investors_mirror (post-011_multi_user_rls): founders have
-- unrestricted read/write; approvers get scoped SELECT through the existing
-- is_founder() helper. Portfolio company data is already visible via each
-- investor's profile, so same trust boundary applies.

create extension if not exists pg_trgm;

-- ── portfolio_companies ──────────────────────────────────────────────────

create table if not exists public.portfolio_companies (
  id              bigserial primary key,
  slug            text not null unique,
  name            text not null,
  sector          text,
  stage           text,
  hq_location     text,
  website         text,
  last_synced_at  timestamptz not null default now()
);

create index if not exists portfolio_companies_name_idx
  on public.portfolio_companies (name);
create index if not exists portfolio_companies_sector_idx
  on public.portfolio_companies (sector);
-- Fuzzy name lookup (future "did you mean…") — safe to build now, it's
-- cheap on 64k rows.
create index if not exists pc_name_trgm_idx
  on public.portfolio_companies using gin (name gin_trgm_ops);

comment on table public.portfolio_companies is
  'Canonical portfolio companies. One row per unique slug. Populated nightly '
  'by research/14c-push-portfolio-to-capital-app.py from the Forge Capital '
  'SQLite. Investor backers live in investor_portfolio_links.';
comment on column public.portfolio_companies.slug is
  'URL-safe canonical slug: lower-case, a-z/0-9/-, no leading/trailing hyphens. '
  'Used as the /portfolio/[slug] path segment and as the upsert key.';

-- ── investor_portfolio_links ────────────────────────────────────────────

create table if not exists public.investor_portfolio_links (
  investor_id          bigint not null references public.investors_mirror(id) on delete cascade,
  portfolio_company_id bigint not null references public.portfolio_companies(id) on delete cascade,
  forge_capital_id     bigint,
  round                text,
  round_at             text,
  amount_raw           text,
  source_url           text,
  last_synced_at       timestamptz not null default now(),
  primary key (investor_id, portfolio_company_id)
);

create index if not exists ipl_portfolio_idx
  on public.investor_portfolio_links (portfolio_company_id);
create index if not exists ipl_investor_idx
  on public.investor_portfolio_links (investor_id);

comment on table public.investor_portfolio_links is
  'Junction between investors_mirror and portfolio_companies. One row per '
  '(investor_id, portfolio_company_id). Round/amount/source_url vary per '
  'investor for the same canonical company.';
comment on column public.investor_portfolio_links.forge_capital_id is
  'Optional source-side id from Forge Capital SQLite portfolio_companies.id. '
  'Kept for traceability, not required — the real identity is the (investor, '
  'portfolio_company) pair.';
comment on column public.investor_portfolio_links.round_at is
  'Free-text round date per pipeline conventions (e.g. "2024-Q2", "Jan 2024", '
  '""). Not a timestamptz because the source rarely supplies a real date.';
comment on column public.investor_portfolio_links.amount_raw is
  'Raw currency string as the pipeline found it ("$50M", "£10M", "—"). '
  'Display-only; no normalisation.';

-- ── RLS ────────────────────────────────────────────────────────────────

alter table public.portfolio_companies        enable row level security;
alter table public.investor_portfolio_links   enable row level security;

-- Founders: full access. Same shape as 011_multi_user_rls.sql's founders_all
-- policies.
drop policy if exists portfolio_companies_founders_all
  on public.portfolio_companies;
create policy portfolio_companies_founders_all
  on public.portfolio_companies for all to authenticated
  using (public.is_founder())
  with check (public.is_founder());

drop policy if exists investor_portfolio_links_founders_all
  on public.investor_portfolio_links;
create policy investor_portfolio_links_founders_all
  on public.investor_portfolio_links for all to authenticated
  using (public.is_founder())
  with check (public.is_founder());

-- Approvers: scoped SELECT. A portfolio_companies row is visible if the
-- approver can see at least one investor_portfolio_links row on it — i.e.
-- the company is backed by an investor they can already see via the
-- existing investors_mirror approver policy.
drop policy if exists investor_portfolio_links_approvers_scoped
  on public.investor_portfolio_links;
create policy investor_portfolio_links_approvers_scoped
  on public.investor_portfolio_links for select to authenticated
  using (
    public.is_founder()
    or exists (
      select 1
      from public.partners_mirror pm
      join public.campaign_partners cp on cp.partner_id = pm.id
      where pm.investor_id = investor_portfolio_links.investor_id
        and public.can_view_campaign(cp.campaign_id)
    )
  );

drop policy if exists portfolio_companies_approvers_scoped
  on public.portfolio_companies;
create policy portfolio_companies_approvers_scoped
  on public.portfolio_companies for select to authenticated
  using (
    public.is_founder()
    or exists (
      select 1
      from public.investor_portfolio_links ipl
      join public.partners_mirror pm  on pm.investor_id = ipl.investor_id
      join public.campaign_partners cp on cp.partner_id = pm.id
      where ipl.portfolio_company_id = portfolio_companies.id
        and public.can_view_campaign(cp.campaign_id)
    )
  );

comment on policy portfolio_companies_founders_all
  on public.portfolio_companies is
  'Founders (platform_founders) have unrestricted read/write.';
comment on policy portfolio_companies_approvers_scoped
  on public.portfolio_companies is
  'Approvers read companies that appear (via a junction row) in investors '
  'visible through their approved campaigns.';
comment on policy investor_portfolio_links_founders_all
  on public.investor_portfolio_links is
  'Founders (platform_founders) have unrestricted read/write.';
comment on policy investor_portfolio_links_approvers_scoped
  on public.investor_portfolio_links is
  'Approvers read junction rows for investors visible through their approved '
  'campaigns.';
