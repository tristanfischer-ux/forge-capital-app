-- 004_campaign_partners.sql
-- The tracker row itself: one per (campaign × partner). This replaces the
-- status column in Tristan's Excel xlsx trackers.
--
-- `status_code` uses the 16-code taxonomy from Outreach-Writing-Rules-TF.md
-- Rule 8. Not enforced at SQL level on purpose — the taxonomy may evolve and
-- we'd rather surface a UI warning on an unknown code than fail a write.
-- Current codes:
--   +12 Committed, +11 Term sheet, +10 NDA/diligence, +9 Meeting held,
--   +8 Meeting scheduled, +7 Meeting offered, +6 Response received,
--   +5 Follow-up sent, +4 Auto-reply/OOO, +3 Email sent,
--   +2 Drafted — ready to send, +1 Approved — awaiting draft, +0 Pending approval,
--   -1 Declined, -2 Bounced, -3 Disqualified

create table if not exists public.campaign_partners (
  id                        uuid primary key default gen_random_uuid(),
  campaign_id               uuid not null references public.campaigns(id) on delete cascade,
  partner_id                bigint not null references public.partners_mirror(id) on delete cascade,
  status_code               text,
  status_label              text,
  last_contact_at           timestamptz,
  approver_note             text,
  approved_by               text,
  approved_at               timestamptz,
  approval_evidence_ref     text,
  created_at                timestamptz not null default now(),
  unique (campaign_id, partner_id)
);

create index if not exists campaign_partners_campaign_id_idx on public.campaign_partners (campaign_id);
create index if not exists campaign_partners_status_code_idx on public.campaign_partners (status_code);
create index if not exists campaign_partners_partner_id_idx on public.campaign_partners (partner_id);

comment on table public.campaign_partners is 'Tracker row per (campaign, partner). The "what stage is this relationship at" dimension.';
comment on column public.campaign_partners.status_code is '16-code taxonomy from Outreach-Writing-Rules-TF.md Rule 8. Unknown codes surfaced in UI, not blocked at SQL level.';
comment on column public.campaign_partners.approval_evidence_ref is 'Pointer to the approver evidence — Gmail thread id, Drive file id, or web-form submission id.';
