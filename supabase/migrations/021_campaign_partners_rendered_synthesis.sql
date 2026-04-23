-- 021_campaign_partners_rendered_synthesis.sql
--
-- Per-investor synthesis cache.
--
-- Fixes the 2026-04-23 grammatical stumble where {{FIRM_THESIS}} token
-- substitution produced sentences like "focuses primarily on Pioneered
-- 'SpaceTech' as an investment category" — verb-leading thesis clauses
-- don't chain cleanly after "primarily on".
--
-- rendered_synthesis: Opus-produced, grammar-correct, per-partner
-- synthesis paragraph. When present, the compose path uses this
-- verbatim instead of template-substituting {{FIRM_THESIS}}.
--
-- rendered_synthesis_at: generation timestamp so the UI can show
-- "last refreshed X minutes ago" and so the drafter can detect stale
-- caches when the template changes.

alter table public.campaign_partners
  add column if not exists rendered_synthesis text,
  add column if not exists rendered_synthesis_at timestamptz;

comment on column public.campaign_partners.rendered_synthesis is
  'Opus-produced per-investor synthesis paragraph. When non-null, the draft composer uses this verbatim instead of {{FIRM_THESIS}} token substitution. Regenerated via the "Refine synthesis with Opus" action on the draft page.';

comment on column public.campaign_partners.rendered_synthesis_at is
  'Timestamp of the most recent Opus synthesis generation for this partner. Used for staleness indicators in the UI.';
