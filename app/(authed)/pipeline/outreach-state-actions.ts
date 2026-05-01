"use server";

import { createServerClient } from "@/lib/supabase/server";

export interface OutreachState {
  partner_id: number;
  last_contacted_at: string | null;
  last_campaign_id: string | null;
  last_campaign_name: string | null;
  total_campaigns_active: number;
  total_emails_sent: number;
  relationship_status: string;
  notes: string | null;
  updated_at: string;
}

export async function getPartnerOutreachState(
  partnerIds: number[],
): Promise<OutreachState[]> {
  if (!partnerIds.length) return [];
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("investor_outreach_state")
    .select("*")
    .in("partner_id", partnerIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as OutreachState[];
}

export async function refreshOutreachState(): Promise<{ ok: boolean }> {
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("sync_investor_outreach_state");
  if (error) throw new Error(error.message);
  return { ok: true };
}
