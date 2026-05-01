-- Cross-campaign awareness: tracks per-partner global outreach state
-- across all campaigns so drafting surfaces can warn when a partner
-- was already contacted for a different campaign.

CREATE TABLE investor_outreach_state (
  partner_id bigint NOT NULL REFERENCES partners_mirror(id),
  last_contacted_at timestamptz,
  last_campaign_id uuid REFERENCES campaigns(id),
  last_campaign_name text,
  total_campaigns_active int NOT NULL DEFAULT 0,
  total_emails_sent int NOT NULL DEFAULT 0,
  relationship_status text NOT NULL DEFAULT 'new'
    CHECK (relationship_status IN ('new','contacted','replied','meeting','declined','invested','inactive')),
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (partner_id)
);

ALTER TABLE investor_outreach_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "founders_all" ON investor_outreach_state
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM platform_founders WHERE email = auth.jwt() ->> 'email')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM platform_founders WHERE email = auth.jwt() ->> 'email')
  );

CREATE OR REPLACE FUNCTION sync_investor_outreach_state()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO investor_outreach_state (
    partner_id,
    last_contacted_at,
    last_campaign_id,
    last_campaign_name,
    total_campaigns_active,
    total_emails_sent,
    relationship_status,
    updated_at
  )
  SELECT
    cp.partner_id,
    MAX(ce.event_at) AS last_contacted_at,
    (ARRAY_AGG(cp.campaign_id ORDER BY cp.created_at DESC))[1] AS last_campaign_id,
    (ARRAY_AGG(c.name ORDER BY cp.created_at DESC))[1] AS last_campaign_name,
    COUNT(DISTINCT cp.campaign_id) AS total_campaigns_active,
    COALESCE(SUM(CASE WHEN ce.direction = 'outbound' THEN 1 ELSE 0 END), 0) AS total_emails_sent,
    CASE
      WHEN MAX(CASE WHEN cp.status_code = '+7' THEN 1 ELSE 0 END) = 1 THEN 'meeting'
      WHEN MAX(CASE WHEN cp.status_code = '+6' THEN 1 ELSE 0 END) = 1 THEN 'replied'
      WHEN MAX(CASE WHEN cp.status_code IN ('-1','-2','-3') THEN 1 ELSE 0 END) = 1 THEN 'declined'
      WHEN MAX(CASE WHEN ce.direction = 'outbound' THEN 1 ELSE 0 END) = 1 THEN 'contacted'
      ELSE 'new'
    END AS relationship_status,
    now()
  FROM campaign_partners cp
  JOIN campaigns c ON c.id = cp.campaign_id
  LEFT JOIN contact_events ce ON ce.campaign_partner_id = cp.id
  GROUP BY cp.partner_id
  ON CONFLICT (partner_id) DO UPDATE SET
    last_contacted_at = EXCLUDED.last_contacted_at,
    last_campaign_id = EXCLUDED.last_campaign_id,
    last_campaign_name = EXCLUDED.last_campaign_name,
    total_campaigns_active = EXCLUDED.total_campaigns_active,
    total_emails_sent = EXCLUDED.total_emails_sent,
    relationship_status = EXCLUDED.relationship_status,
    updated_at = now();
END;
$$;
