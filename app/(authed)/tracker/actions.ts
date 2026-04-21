"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { labelFor, STATUS_BY_CODE } from "@/lib/status-codes";
import type { ContactEventRow } from "@/lib/queries/campaignPartner";

/**
 * Server action: fetch contact events for one tracker row. Exposed as
 * an action (not a route handler) so the client drawer can call it
 * directly via React Server Actions without a separate API surface.
 */
export async function fetchContactEvents(
  campaignPartnerId: string,
): Promise<ContactEventRow[]> {
  if (!campaignPartnerId) return [];
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("contact_events")
    .select("id, direction, channel, event_type, event_at, summary")
    .eq("campaign_partner_id", campaignPartnerId)
    .order("event_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []) as ContactEventRow[];
}

/**
 * Server action: update a campaign_partners row AND log the change as
 * a contact_event so commentary history is preserved.
 *
 * Input contract is deliberately narrow — `status_code` (nullable) and
 * a free-text `commentary` line. We derive status_label server-side from
 * the 16-code legend so the two columns never drift.
 *
 * RLS enforces the actor — only the authenticated session's JWT email
 * matching `tristan.fischer@gmail.com` (V1 policy in migration 007).
 * No service-role bypass here; that's the point of using the ssr
 * server client instead of the admin client.
 */
export async function updateCampaignPartnerStatus(input: {
  campaignPartnerId: string;
  statusCode: string | null;
  commentary: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { campaignPartnerId, statusCode, commentary } = input;

  if (!campaignPartnerId) return { ok: false, error: "campaignPartnerId required" };
  if (statusCode !== null && !STATUS_BY_CODE[statusCode]) {
    return { ok: false, error: `Unknown status code '${statusCode}'` };
  }
  const trimmedCommentary = (commentary ?? "").trim();

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  // Update the tracker row. status_label derives from the legend so UI
  // and DB stay in lock-step.
  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = {
    status_code: statusCode,
    status_label: labelFor(statusCode),
  };
  // Bump last_contact_at ONLY if the commentary indicates a new touchpoint.
  // A bare status change (no commentary) shouldn't reset days-since-last-contact.
  if (trimmedCommentary.length > 0) {
    update.last_contact_at = nowIso;
  }

  const { error: updateErr } = await supabase
    .from("campaign_partners")
    .update(update)
    .eq("id", campaignPartnerId);
  if (updateErr) return { ok: false, error: updateErr.message };

  // Always log the event — even if only the status changed, the log row
  // records who/when/what so the commentary history reflects every touch.
  const summary = trimmedCommentary.length > 0
    ? (statusCode ? `[${statusCode}] ${trimmedCommentary}` : trimmedCommentary)
    : (statusCode ? `Status set to ${statusCode} ${labelFor(statusCode) ?? ""}`.trim() : "Status cleared");

  const { error: eventErr } = await supabase
    .from("contact_events")
    .insert({
      campaign_partner_id: campaignPartnerId,
      direction: "manual",
      channel: "manual",
      event_type: trimmedCommentary.length > 0 ? "manual_note" : "status_update",
      event_at: nowIso,
      summary,
    });
  if (eventErr) return { ok: false, error: eventErr.message };

  revalidatePath("/tracker");
  return { ok: true };
}
