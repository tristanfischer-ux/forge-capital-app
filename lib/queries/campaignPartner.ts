import { createServerClient } from "@/lib/supabase/server";

/**
 * One contact event row — sent/reply/bounce/manual-note/status-update.
 * These are the primitives the commentary log drawer renders. The
 * Gmail ingest runner (Phase 8) will be the heavy writer here; for V1
 * the only writer is the tracker drawer recording manual status edits.
 */
export interface ContactEventRow {
  id: string;
  direction: string | null;
  channel: string | null;
  event_type: string | null;
  event_at: string;
  summary: string | null;
  /** Gmail thread id when this event was produced by a Gmail send/reply.
   *  Enables the commentary log to deep-link into Gmail. */
  gmail_thread_id: string | null;
}

/**
 * Fetch contact events for a campaign_partners row, newest first.
 * Limited to 50 entries — older history sinks into an "earlier" view
 * we build in Phase 6 (not here).
 */
export async function getContactEvents(
  campaignPartnerId: string,
  limit = 50,
): Promise<ContactEventRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("contact_events")
    .select("id, direction, channel, event_type, event_at, summary, gmail_thread_id")
    .eq("campaign_partner_id", campaignPartnerId)
    .order("event_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("getContactEvents failed:", error.message);
    return [];
  }
  return (data ?? []) as ContactEventRow[];
}
