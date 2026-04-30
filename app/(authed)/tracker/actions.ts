"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { labelFor, STATUS_BY_CODE } from "@/lib/status-codes";
import type { ContactEventRow } from "@/lib/queries/campaignPartner";

/**
 * Server action: look up a partner's email via the Hunter.io Email Finder
 * API. On success, writes the discovered email to
 * `campaign_partners.partner_email_overrides` so subsequent draft
 * composition picks it up.
 */
export async function findPartnerEmail(input: {
  campaignPartnerId: string;
  fullName: string;
  domain: string;
}): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const { campaignPartnerId, fullName, domain } = input;
  if (!campaignPartnerId) return { ok: false, error: "campaignPartnerId required" };
  if (!fullName.trim()) return { ok: false, error: "Name is required" };
  if (!domain.trim()) return { ok: false, error: "Domain is required" };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) return { ok: false, error: "Hunter API key not configured" };

  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(cleanDomain)}&full_name=${encodeURIComponent(fullName.trim())}&api_key=${encodeURIComponent(apiKey)}`;

  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    return { ok: false, error: `Hunter API ${resp.status}: ${body.slice(0, 200)}` };
  }

  const json = await resp.json();
  const email = json?.data?.email;
  if (!email) return { ok: false, error: "No email found for this name + domain" };

  const { error: updateErr } = await supabase
    .from("campaign_partners")
    .update({ partner_email_overrides: email })
    .eq("id", campaignPartnerId);
  if (updateErr) return { ok: false, error: updateErr.message };

  revalidatePath("/tracker");
  return { ok: true, email };
}

/**
 * Server action: apply a synthesised note (from the tracker drop-zone)
 * to an existing campaign_partners row. Optional status bump via
 * `suggestedStatusCode`. The note is appended as a contact_events
 * row with direction='manual', channel='manual', event_type='drop_note',
 * so it shows in the commentary log exactly like a hand-typed drawer entry.
 *
 * Distinct from `updateCampaignPartnerStatus` in that the note here
 * comes from a pitch/email/snippet the user dropped, not typed. We keep
 * the entry points separate so the audit trail stays legible.
 */
export async function applyDropNoteToRow(input: {
  campaignPartnerId: string;
  note: string;
  suggestedStatusCode: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { campaignPartnerId, note, suggestedStatusCode } = input;
  if (!campaignPartnerId) return { ok: false, error: "campaignPartnerId required" };
  const trimmed = (note ?? "").trim();
  if (trimmed.length === 0) return { ok: false, error: "note empty" };
  if (suggestedStatusCode && !STATUS_BY_CODE[suggestedStatusCode]) {
    return { ok: false, error: `Unknown status code '${suggestedStatusCode}'` };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const nowIso = new Date().toISOString();

  if (suggestedStatusCode) {
    const { error: updateErr } = await supabase
      .from("campaign_partners")
      .update({
        status_code: suggestedStatusCode,
        status_label: labelFor(suggestedStatusCode),
        last_contact_at: nowIso,
      })
      .eq("id", campaignPartnerId);
    if (updateErr) return { ok: false, error: updateErr.message };
  } else {
    const { error: bumpErr } = await supabase
      .from("campaign_partners")
      .update({ last_contact_at: nowIso })
      .eq("id", campaignPartnerId);
    if (bumpErr) return { ok: false, error: bumpErr.message };
  }

  const summary = suggestedStatusCode
    ? `[${suggestedStatusCode}] ${trimmed}`
    : trimmed;

  const { error: eventErr } = await supabase
    .from("contact_events")
    .insert({
      campaign_partner_id: campaignPartnerId,
      direction: "manual",
      channel: "manual",
      event_type: "drop_note",
      event_at: nowIso,
      summary,
    });
  if (eventErr) return { ok: false, error: eventErr.message };

  revalidatePath("/tracker");
  return { ok: true };
}

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
    .select("id, direction, channel, event_type, event_at, summary, gmail_thread_id")
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
 * RLS enforces the actor via migration 011_multi_user_rls.sql —
 * founders (rows in `platform_founders`) have full access; approvers
 * have SELECT only on their campaigns. Writes from approvers flow
 * through the script-based approval parser (service role), so this
 * action is effectively founder-only when called from the web UI.
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
