-- Track when first contact was made with a campaign partner.
-- Set once on first outreach; never overwritten.

ALTER TABLE campaign_partners
  ADD COLUMN IF NOT EXISTS first_contact_at timestamptz;

-- Backfill from earliest contact_event for each partner.
UPDATE campaign_partners cp
SET first_contact_at = sub.first_at
FROM (
  SELECT campaign_partner_id, MIN(event_at) as first_at
  FROM contact_events
  GROUP BY campaign_partner_id
) sub
WHERE cp.id = sub.campaign_partner_id
  AND cp.first_contact_at IS NULL;

-- Trigger: auto-set first_contact_at on first outreach.
CREATE OR REPLACE FUNCTION set_first_contact_at()
RETURNS trigger AS $$
BEGIN
  IF NEW.first_contact_at IS NULL
     AND NEW.last_contact_at IS NOT NULL
     AND (OLD.last_contact_at IS NULL OR OLD.first_contact_at IS NULL)
  THEN
    NEW.first_contact_at := COALESCE(NEW.last_contact_at, now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_first_contact_at ON campaign_partners;
CREATE TRIGGER trg_set_first_contact_at
  BEFORE UPDATE ON campaign_partners
  FOR EACH ROW
  EXECUTE FUNCTION set_first_contact_at();
