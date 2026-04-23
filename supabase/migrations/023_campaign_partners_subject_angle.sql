-- 023_campaign_partners_subject_angle.sql
--
-- Per-investor subject angle — 2-5 words, the tailored parenthetical
-- at the end of every cold-outreach subject line per Rule 2.
--
-- Example v7 TF format: "SkySails Power — airborne wind energy,
-- €5M Series A bridge (DACH deep-tech hardware)". The bit in parens
-- is the subject_angle — insightful, per-firm, not a raw sector tag.
--
-- Produced by Opus at the same time as rendered_synthesis (one JSON
-- call, two outputs) and written here for reuse across preview,
-- batch dispatch, and per-row send paths.
alter table public.campaign_partners
  add column if not exists subject_angle text;

comment on column public.campaign_partners.subject_angle is
  'Opus-produced per-firm subject-line angle (2-5 words). The trailing parenthetical on outreach subjects per Rule 2. Generated alongside rendered_synthesis by refineSynthesisWithOpus.';
