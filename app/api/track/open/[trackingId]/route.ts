import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Email open-tracking pixel.
 *
 * Returns a 1×1 transparent GIF so the browser/email client renders
 * nothing visible. When an email client loads the pixel, this endpoint:
 *   1. Decodes the trackingId (base64url → JSON: { campaignPartnerId, sentAt })
 *   2. Inserts a contact_event row with event_type='email_opened'
 *   3. Returns the pixel
 *
 * The insert is best-effort — a failure must never break the pixel
 * response; we still return the GIF so the client does not retry
 * aggressively.
 *
 * trackingId encoding: base64url(JSON.stringify({ c: campaignPartnerId, t: sentAtMs }))
 */

// 1×1 transparent GIF (43 bytes)
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

function decodeTrackingId(
  raw: string,
): { campaignPartnerId: string; sentAt: number } | null {
  try {
    // base64url → base64
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(b64, "base64").toString("utf8");
    const parsed = JSON.parse(json) as { c: string; t: number };
    if (typeof parsed.c !== "string" || typeof parsed.t !== "number") return null;
    return { campaignPartnerId: parsed.c, sentAt: parsed.t };
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ trackingId: string }> },
) {
  const { trackingId } = await params;

  const pixelResponse = new NextResponse(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
    },
  });

  const decoded = decodeTrackingId(trackingId);
  if (!decoded) {
    // Bad tracking ID — still return the pixel, just don't record
    return pixelResponse;
  }

  // Record open event — best-effort, never block the pixel response
  try {
    const supabase = createAdminClient();
    const userAgent = req.headers.get("user-agent") ?? null;
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      null;

    await supabase.from("contact_events").insert({
      campaign_partner_id: decoded.campaignPartnerId,
      direction: "inbound",
      channel: "gmail",
      event_type: "email_opened",
      event_at: new Date().toISOString(),
      summary: "Email opened (tracking pixel loaded)",
      tracking_metadata: {
        user_agent: userAgent,
        ip,
        sent_at: new Date(decoded.sentAt).toISOString(),
      },
    });
  } catch (err) {
    // Log but never throw — the pixel must always return
    console.error("[track/open] insert failed:", err);
  }

  return pixelResponse;
}
