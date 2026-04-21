-- 002_investors_mirror.sql
-- Read-mostly mirror of the Forge Capital `investors` table
-- (~8,000 active rows). Populated nightly by `research/14-push-capital-app.py`
-- from `~/.forge-capital/forge-capital.db`. The web app reads this; it never
-- scrapes or enriches directly.
--
-- `id` is a bigint so it matches the FC source integer PK — this is the join
-- key for `partners_mirror.investor_id`.

create table if not exists public.investors_mirror (
  id                      bigint primary key,
  firm_name               text,
  type                    text,
  website                 text,
  hq_location             text,
  thesis_summary          text,
  thesis_deep             text,
  stage_focus             text,
  sector_focus            text,
  geo_focus               text,
  cheque_min_usd          numeric,
  cheque_max_usd          numeric,
  fund_size_usd           numeric,
  actively_deploying      boolean,
  synthesis_data          jsonb,
  synthesis_confidence    text,
  connection_brief        text,
  investment_pattern      text,
  team_expertise          text,
  chrome_verified         boolean,
  last_synced_at          timestamptz not null default now()
);

create index if not exists investors_mirror_firm_name_idx on public.investors_mirror (firm_name);
create index if not exists investors_mirror_actively_deploying_idx on public.investors_mirror (actively_deploying);

comment on table public.investors_mirror is 'Nightly mirror of Forge Capital `investors`. Read-mostly. Source of truth is ~/.forge-capital/forge-capital.db.';
comment on column public.investors_mirror.id is 'Matches Forge Capital `investors.id` exactly (bigint). Never regenerate.';
