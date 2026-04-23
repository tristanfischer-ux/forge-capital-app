-- 020_campaigns_founder_bio_voice_reference.sql
--
-- Two new columns on campaigns so the Haiku drafter has CONCRETE FACTS
-- to lean on instead of emitting [bracketed placeholders]. The
-- bracketed-placeholder failure was what shipped to Tristan's inbox on
-- 2026-04-23 — Haiku was literally following a prompt instruction to
-- "use [brackets] when specific numbers aren't provided". Fix: supply
-- the numbers, and ban brackets in the prompt.
--
-- founder_bio: free text the founder writes once per campaign. Tristan
-- for the Wren/SkySails/FishFrom raises would write a single paragraph
-- covering Citigroup → Shell Technology Ventures → Lumicity → C-Capture
-- → Fischer Farms with the real dates and real backers.
--
-- voice_reference_email: a full prior outbound email from the founder,
-- pasted verbatim. Haiku reads it as a few-shot exemplar of tone, rhythm
-- and structure. The canonical example is the SkySails → Christophe
-- (Quantonation) send documented in docs/voice-reference-skysails-quantonation.md.

alter table public.campaigns
  add column if not exists founder_bio text,
  add column if not exists voice_reference_email text;

comment on column public.campaigns.founder_bio is
  'Concrete factual bio of the founder doing the sending. Haiku reads this to write the credibility paragraph WITHOUT bracketed placeholders. One paragraph, first-person, specific numbers and named employers — same voice as voice_reference_email.';

comment on column public.campaigns.voice_reference_email is
  'Full prior outbound email from the founder, pasted verbatim. Used as a few-shot exemplar by the Haiku drafter. Canonical example: the SkySails → Quantonation send in docs/voice-reference-skysails-quantonation.md.';
