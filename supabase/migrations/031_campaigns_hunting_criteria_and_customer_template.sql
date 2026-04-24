-- 031_campaigns_hunting_criteria_and_customer_template.sql
--
-- Backs Steps 2 and 6 of the new /send/[campaignId] linear outreach
-- flow (Tristan 2026-04-24):
--
--   Step 1 — Customer brief        (reads campaigns.company_description)
--   Step 2 — Hunting criteria      (this column: hunting_criteria)
--   Step 3 — Search for customers
--   Step 4 — Pick customers
--   Step 5 — Email resolution
--   Step 6 — Template              (this column: customer_template)
--   Step 7 — Draft all emails
--   Step 8 — Approve batch
--   Step 9 — Queue + final review + send + monitor
--
-- hunting_criteria describes the SHAPE of the customer we want to
-- target (retail channel, geography, size band, carbon/regulatory
-- exposure, etc.), separate from company_description which describes
-- OUR product. Tristan's 2026-04-24 direction: "What you're hunting
-- for — this is different."
--
-- customer_template is the agreed outreach template voice for this
-- campaign. Opus uses it as a few-shot reference when drafting
-- per-customer emails in Step 7. The investor-side equivalent is
-- voice_reference_email (migration 020) — we keep them separate
-- because the customer voice differs meaningfully from the investor
-- voice (solution-framed vs thesis-framed) and a campaign is
-- either customer-intent or investor-intent, not both.

alter table public.campaigns
  add column if not exists hunting_criteria text,
  add column if not exists customer_template text;

comment on column public.campaigns.hunting_criteria is
  'Step 2 of the /send flow: describes what kind of customer we are hunting for (retail channel, geography, size band, etc.). Separate from company_description (our product) — this one describes THEIR shape. Added 2026-04-24 for the Fischer Farms self-managed outreach redesign.';

comment on column public.campaigns.customer_template is
  'Step 6 of the /send flow: the agreed customer-outreach template voice. Used as a few-shot reference for Opus when drafting per-customer emails in Step 7 (alongside voice_reference_email which remains the investor equivalent). Tristan edits this once per campaign; composer substitutes it per recipient. Added 2026-04-24.';
