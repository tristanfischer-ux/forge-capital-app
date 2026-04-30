-- 034_campaign_partners_draft_overrides.sql
--
-- Adds per-partner draft overrides so the Gmail drafts panel can store
-- inline edits to subject and body without touching the campaign-level
-- email_templates row.
--
-- When non-null, the drafts panel and full composer should prefer these
-- override values over the derived/composed values.
--
-- Design notes:
--   - draft_subject_override: free-text subject line; replaces the
--     derived subject when present.
--   - draft_body_override: full email body; replaces the composed
--     4-part body when present. Stored as plain text (newline-separated
--     paragraphs), matching what the composer produces.
--   - draft_discarded_at: when non-null, this partner's draft has been
--     discarded. The drafts panel hides discarded rows. Status_code is
--     moved back to +1 by the discard action (the partner is still
--     approved, just no longer in the "ready to send" queue).

alter table public.campaign_partners
  add column if not exists draft_subject_override text,
  add column if not exists draft_body_override    text,
  add column if not exists draft_discarded_at     timestamptz;

comment on column public.campaign_partners.draft_subject_override is
  'Founder-edited subject line for this partner''s draft. When non-null, used verbatim instead of the derived subject.';
comment on column public.campaign_partners.draft_body_override is
  'Founder-edited full email body for this partner''s draft. When non-null, used verbatim instead of the composed 4-part body.';
comment on column public.campaign_partners.draft_discarded_at is
  'When set, this partner''s draft was discarded by the founder. The drafts panel hides these rows.';
