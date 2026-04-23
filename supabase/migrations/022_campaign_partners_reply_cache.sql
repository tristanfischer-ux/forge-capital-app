-- 022_campaign_partners_reply_cache.sql
--
-- Cache reply classification + Opus-drafted response on the partner
-- row so the /approval/test-replies page can survive reloads without
-- re-hitting Opus for every inbound message.
alter table public.campaign_partners
  add column if not exists reply_sentiment text,
  add column if not exists drafted_response text;

comment on column public.campaign_partners.reply_sentiment is
  'positive | negative | neutral — Opus classification of the most recent inbound reply on this thread. Written by classifyAndDraftResponse and cleared on status-code transitions that invalidate it.';

comment on column public.campaign_partners.drafted_response is
  'Opus-drafted response paragraph, ready for send via sendResponseAndUpdateStatus. Cached so reloads of /approval/test-replies do not re-run Opus.';
