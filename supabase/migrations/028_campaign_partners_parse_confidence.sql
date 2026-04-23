-- 028_campaign_partners_parse_confidence.sql
--
-- UX audit 2026-04-23 item #12: the Haiku approval-reply parser buckets
-- every row as approved / flag / rejected without surfacing how confident
-- it was in the match. A mis-parse is therefore silent — if Haiku flips
-- "ok for Felicis, but pass on AENU" into the wrong bucket, the founder
-- has to read all 20 rows manually to catch it.
--
-- This migration adds `parse_confidence` as a nullable `real` (0.0–1.0)
-- on `campaign_partners`. The reply parser writes the score the Haiku
-- response already returns; the /approval Step 3 table renders it as a
-- per-row badge with a colour tier (green ≥ 0.85, amber 0.60–0.84,
-- red < 0.60) so the founder can spot low-confidence rows at a glance.
--
-- Null is the safe default — existing rows that were parsed before this
-- column existed don't get a fake score retroactively. The UI falls
-- back to the plain decision badge when the confidence is null so no
-- legacy row breaks.

alter table public.campaign_partners
  add column if not exists parse_confidence real;

comment on column public.campaign_partners.parse_confidence is
  'Haiku approval-reply parser confidence in the extracted verdict (0.0 – 1.0). Null for rows where the parser did not run or pre-dated the column. UX audit 2026-04-23 item #12: surfaced as a coloured badge on /approval Step 3 so low-confidence parses are visibly reviewable.';
