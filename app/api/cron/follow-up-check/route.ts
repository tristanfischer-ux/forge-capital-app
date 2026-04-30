import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Vercel Cron — Follow-up suggestion check.
 *
 * Runs daily. Finds campaign_partners where:
 *   - An email was sent (contact_events event_type = 'email_sent' OR
 *     direction = 'outbound')
 *   - The email was opened (contact_events event_type = 'email_opened')
 *   - No reply was received after the send (no inbound contact_events
 *     with event_at > the send event_at)
 *   - The open was 5 or more days ago
 *   - No follow_up_suggested event already exists for this partner
 *     since the open (to avoid duplicate suggestions)
 *
 * For each match, inserts a contact_event with
 * event_type = 'follow_up_suggested'. This does NOT send any email —
 * it flags the partner for Tristan's review on the /follow-ups page.
 *
 * Schedule: 0 8 * * * (08:00 UTC daily)
 *
 * HARD RULE: this cron NEVER sends email. It only inserts
 * follow_up_suggested events. The "nothing sends without approval"
 * rule (CLAUDE.md) is inviolable.
 */

export const maxDuration = 60;

const OPEN_AGE_DAYS = 5;

// Minimal type for the rows we query
interface OpenEvent {
  id: string;
  campaign_partner_id: string;
  event_at: string;
  tracking_metadata: Record<string, unknown> | null;
}

interface SendEvent {
  campaign_partner_id: string;
  event_at: string;
}

export async function GET(req: NextRequest) {
  // Vercel cron requests include an Authorization header with CRON_SECRET
  const authHeader = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new NextResponse("Unauthorised", { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const cutoff = new Date(
    now.getTime() - OPEN_AGE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // 1. Find all email_opened events that are 5+ days old
  const { data: openEvents, error: openErr } = await supabase
    .from("contact_events")
    .select("id, campaign_partner_id, event_at, tracking_metadata")
    .eq("event_type", "email_opened")
    .lte("event_at", cutoff)
    .order("event_at", { ascending: false });

  if (openErr) {
    console.error("[follow-up-check] open events query failed:", openErr.message);
    return NextResponse.json({ error: openErr.message }, { status: 500 });
  }

  const opens = (openEvents ?? []) as OpenEvent[];
  if (opens.length === 0) {
    return NextResponse.json({ suggested: 0, message: "No qualifying open events." });
  }

  const partnerIds = [...new Set(opens.map((e) => e.campaign_partner_id))];

  // 2. For each partner, check: any inbound reply AFTER the open? any
  //    follow_up_suggested already inserted AFTER the open?
  // We batch-fetch all relevant events for these partners in two queries.

  const { data: inboundEvents, error: inboundErr } = await supabase
    .from("contact_events")
    .select("campaign_partner_id, event_at")
    .in("campaign_partner_id", partnerIds)
    .eq("direction", "inbound")
    .neq("event_type", "email_opened") // opened ≠ replied
    .order("event_at", { ascending: false });

  if (inboundErr) {
    console.error("[follow-up-check] inbound query failed:", inboundErr.message);
    return NextResponse.json({ error: inboundErr.message }, { status: 500 });
  }

  const { data: alreadySuggested, error: suggErr } = await supabase
    .from("contact_events")
    .select("campaign_partner_id, event_at")
    .in("campaign_partner_id", partnerIds)
    .eq("event_type", "follow_up_suggested")
    .order("event_at", { ascending: false });

  if (suggErr) {
    console.error("[follow-up-check] already-suggested query failed:", suggErr.message);
    return NextResponse.json({ error: suggErr.message }, { status: 500 });
  }

  // Build lookup maps: partnerId → most recent inbound event_at
  const latestInbound = new Map<string, Date>();
  for (const ev of (inboundEvents ?? []) as SendEvent[]) {
    if (!latestInbound.has(ev.campaign_partner_id)) {
      latestInbound.set(ev.campaign_partner_id, new Date(ev.event_at));
    }
  }

  // Build lookup map: partnerId → most recent follow_up_suggested event_at
  const latestSuggestion = new Map<string, Date>();
  for (const ev of (alreadySuggested ?? []) as SendEvent[]) {
    if (!latestSuggestion.has(ev.campaign_partner_id)) {
      latestSuggestion.set(ev.campaign_partner_id, new Date(ev.event_at));
    }
  }

  // 3. For each partner, find the LATEST open event and decide whether
  //    to suggest follow-up
  const latestOpenPerPartner = new Map<string, OpenEvent>();
  for (const ev of opens) {
    if (!latestOpenPerPartner.has(ev.campaign_partner_id)) {
      latestOpenPerPartner.set(ev.campaign_partner_id, ev);
    }
  }

  const toInsert: Array<{
    campaign_partner_id: string;
    direction: string;
    channel: string;
    event_type: string;
    event_at: string;
    summary: string;
    tracking_metadata: Record<string, unknown>;
  }> = [];

  for (const [partnerId, openEvent] of latestOpenPerPartner) {
    const openedAt = new Date(openEvent.event_at);

    // Skip if there's been an inbound reply after the open
    const lastReply = latestInbound.get(partnerId);
    if (lastReply && lastReply > openedAt) {
      continue;
    }

    // Skip if a follow_up_suggested was already inserted after this open
    const lastSuggestion = latestSuggestion.get(partnerId);
    if (lastSuggestion && lastSuggestion > openedAt) {
      continue;
    }

    const daysSinceOpen = Math.floor(
      (now.getTime() - openedAt.getTime()) / (24 * 60 * 60 * 1000),
    );

    toInsert.push({
      campaign_partner_id: partnerId,
      direction: "manual",
      channel: "manual",
      event_type: "follow_up_suggested",
      event_at: now.toISOString(),
      summary: `Follow-up suggested: email was opened ${daysSinceOpen} days ago with no reply.`,
      tracking_metadata: {
        opened_at: openEvent.event_at,
        days_since_open: daysSinceOpen,
        open_event_id: openEvent.id,
        auto_generated: true,
      },
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({
      suggested: 0,
      message: "All qualifying opens already have replies or suggestions.",
    });
  }

  // 4. Insert suggestions in one batch
  const { error: insertErr } = await supabase
    .from("contact_events")
    .insert(toInsert);

  if (insertErr) {
    console.error("[follow-up-check] insert failed:", insertErr.message);
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  console.log(`[follow-up-check] inserted ${toInsert.length} follow_up_suggested events`);
  return NextResponse.json({
    suggested: toInsert.length,
    partner_ids: toInsert.map((r) => r.campaign_partner_id),
  });
}
