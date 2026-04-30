import { createServerClient } from "@/lib/supabase/server";

export interface InboxRow {
  id: string;
  campaign_partner_id: string;
  event_at: string;
  summary: string | null;
  event_type: string | null;
  gmail_thread_id: string | null;
  firm_name: string | null;
  partner_name: string | null;
  partner_title: string | null;
  campaign_name: string | null;
  status_code: string | null;
  status_label: string | null;
}

interface InboxJoinRow {
  id: string;
  campaign_partner_id: string;
  event_at: string;
  summary: string | null;
  event_type: string | null;
  gmail_thread_id: string | null;
  campaign_partners: {
    status_code: string | null;
    status_label: string | null;
    partners_mirror: {
      name: string | null;
      title: string | null;
      investors_mirror: {
        firm_name: string | null;
      } | null;
    } | null;
    campaigns: {
      name: string | null;
    } | null;
  } | null;
}

/**
 * Fetch inbound contact events (replies from investors/partners).
 * These are the events Tristan currently has to go to Gmail to see.
 */
export async function getInboxReplies(limit = 100): Promise<InboxRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("contact_events")
    .select(
      `
      id,
      campaign_partner_id,
      event_at,
      summary,
      event_type,
      gmail_thread_id,
      campaign_partners:campaign_partner_id (
        status_code,
        status_label,
        partners_mirror:partner_id (
          name,
          title,
          investors_mirror:investor_id (
            firm_name
          )
        ),
        campaigns:campaign_id (
          name
        )
      )
      `,
    )
    .eq("direction", "inbound")
    .order("event_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("getInboxReplies failed:", error.message);
    return [];
  }

  return ((data ?? []) as unknown as InboxJoinRow[]).map((r) => ({
    id: r.id,
    campaign_partner_id: r.campaign_partner_id,
    event_at: r.event_at,
    summary: r.summary,
    event_type: r.event_type,
    gmail_thread_id: r.gmail_thread_id,
    firm_name: r.campaign_partners?.partners_mirror?.investors_mirror?.firm_name ?? null,
    partner_name: r.campaign_partners?.partners_mirror?.name ?? null,
    partner_title: r.campaign_partners?.partners_mirror?.title ?? null,
    campaign_name: r.campaign_partners?.campaigns?.name ?? null,
    status_code: r.campaign_partners?.status_code ?? null,
    status_label: r.campaign_partners?.status_label ?? null,
  }));
}
