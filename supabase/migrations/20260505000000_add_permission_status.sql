-- Add permission_status to campaign_partners for client permission workflow.
-- Values: 'not_required' (default), 'pending_approval', 'approved', 'denied'
-- This lets Tristan export a list of investors needing client permission,
-- send it to the client, and record their yes/no response.

ALTER TABLE public.campaign_partners
  ADD COLUMN IF NOT EXISTS permission_status text NOT NULL DEFAULT 'not_required';

-- Add a CHECK constraint for valid values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_partners_permission_status_check'
  ) THEN
    ALTER TABLE public.campaign_partners
      ADD CONSTRAINT campaign_partners_permission_status_check
      CHECK (permission_status IN ('not_required', 'pending_approval', 'approved', 'denied'));
  END IF;
END $$;

-- Index for quick lookup of investors needing permission
CREATE INDEX IF NOT EXISTS idx_campaign_partners_permission_status
  ON public.campaign_partners (campaign_id, permission_status)
  WHERE permission_status = 'pending_approval';

-- RLS policy: same as existing campaign_partners policies
-- (they inherit from the table-level RLS)

COMMENT ON COLUMN public.campaign_partners.permission_status IS
  'Client permission workflow: not_required (default), pending_approval (exported to client), approved (client said yes), denied (client said no — blocks outreach)';
