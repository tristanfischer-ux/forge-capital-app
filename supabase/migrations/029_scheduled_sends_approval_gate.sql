-- 029_scheduled_sends_approval_gate.sql
--
-- HARD RULE (Tristan 2026-04-24):
-- "there is no permission to automatically send things until they have
-- been approved. That has to be a very fast rule that cannot be broken."
--
-- This migration enforces that rule at the database layer so no server
-- action, script, admin SQL, or future code change can sneak an
-- unapproved row into the dispatcher queue.
--
-- Policy: a row in public.scheduled_sends may only reference a
-- campaign_partners row whose current status_code is +1 (Approved —
-- awaiting draft) or +2 (Drafted — ready to send) at the moment of
-- INSERT. +0 (Pending approval) is explicitly rejected. Once queued,
-- the dispatcher flipping the CP to +3 (Email sent) is fine — this
-- guard only runs on INSERT, not on UPDATE of the referenced row.
--
-- If a row is ever found to have slipped through (legacy bug, manual
-- SQL, future mistake), the trigger raises exception code 'P0001' with
-- a clear message naming the offending CP row so the fix is obvious.

create or replace function public.enforce_scheduled_send_approval_gate()
returns trigger
language plpgsql
security definer
as $$
declare
  cp_status text;
begin
  select status_code
    into cp_status
    from public.campaign_partners
   where id = new.campaign_partner_id;

  if cp_status is null then
    raise exception using
      errcode = 'P0001',
      message = format(
        'scheduled_sends insert rejected: campaign_partner %snot found',
        new.campaign_partner_id
      );
  end if;

  if cp_status not in ('+1', '+2') then
    raise exception using
      errcode = 'P0001',
      message = format(
        'scheduled_sends insert rejected: campaign_partner %sis at status_code %s, must be +1 (Approved) or +2 (Drafted) before scheduling. Ingest approval decisions on /approval first.',
        new.campaign_partner_id,
        cp_status
      );
  end if;

  return new;
end;
$$;

drop trigger if exists scheduled_sends_approval_gate on public.scheduled_sends;
create trigger scheduled_sends_approval_gate
  before insert on public.scheduled_sends
  for each row
  execute function public.enforce_scheduled_send_approval_gate();

comment on function public.enforce_scheduled_send_approval_gate() is
  'Hard safety rule: no row may enter scheduled_sends unless the referenced campaign_partners row is at status_code +1 or +2 (approved or drafted). Pending (+0) is rejected. Cannot be bypassed by the schedule-send server action, the dispatcher daemon, or admin SQL. Added 2026-04-24 after Tristan: "there is no permission to automatically send things until they have been approved. That has to be a very fast rule that cannot be broken."';
