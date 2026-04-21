-- 006_email_templates.sql
-- One template per campaign. The 4-part real-template structure from
-- Outreach-Writing-Rules-TF.md + REAL-TEMPLATES-FROM-GMAIL.md:
--   1. Credibility paragraph (full or short variant)
--   2. Company paragraph (per campaign, verbatim from a real send)
--   3. Intelligent synthesis (with {{FIRM_NAME}} / {{FIRM_THESIS}} placeholders)
--   4. Call to action (20min_call or presentation_first)
--
-- The web app composes the final email by:
--   credibility_paragraph_full + company_paragraph + rendered(intelligent_synthesis_template)
--   + optional video link + cta block.

create table if not exists public.email_templates (
  id                              uuid primary key default gen_random_uuid(),
  campaign_id                     uuid not null references public.campaigns(id) on delete cascade,
  template_name                   text,
  credibility_paragraph_short     text,
  credibility_paragraph_full      text,
  company_paragraph               text,
  intelligent_synthesis_template  text,
  cta_variant                     text check (cta_variant in ('20min_call','presentation_first')),
  full_template_rendered          text,
  source_thread_id                text,
  captured_from                   text,
  captured_at                     timestamptz not null default now()
);

create index if not exists email_templates_campaign_id_idx on public.email_templates (campaign_id);

comment on table public.email_templates is 'Real outreach templates, verbatim from Tristan sent mail. Never invent copy here.';
comment on column public.email_templates.intelligent_synthesis_template is 'Body with {{FIRM_NAME}} and {{FIRM_THESIS}} placeholders. Must open with a Rule-1 hedge ("My understanding is that..." or "I am reaching out because...").';
comment on column public.email_templates.source_thread_id is 'Gmail thread id this template was captured from (so we can re-verify voice).';
