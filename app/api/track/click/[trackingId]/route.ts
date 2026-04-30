import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Click-tracking redirect.
 *
 * Decodes the trackingId to recover:
 *   - the original destination URL
 *   - the campaignPartnerId the link belongs to
 *
 * Records a contact_event with event_type='link_clicked', then 302s
 * the user to the original URL. The redirect must happen regardless
 * of whether the DB write succeeds.
 *
 * trackingId encoding:
 *   base64url(JSON.stringify({ c: campaignPartnerId, t: sentAtMs, u: originalUrl }))
 */

function decodeTrackingId(raw: string): {
  campaignPartnerId: string;
  sentAt: number;
  originalUrl: string;
} | null {
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(b64, "base64").toString("utf8");
    const parsed = JSON.parse(json) as {
      c: string;
      t: number;
      u: string;
    };
    if (
      typeof parsed.c !== "string" ||
      typeof parsed.t !== "number" ||
      typeof parsed.u !== "string"
    )
      return null;
    // Basic URL safety check — must be http(s)
    if (!/^https?:\/\//i.test(parsed.u)) return null;
    return {
      campaignPartnerId: parsed.c,
      sentAt: parsed.t,
      originalUrl: parsed.u,
    };
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ trackingId: string }> },
) {
  const { trackingId } = await params;
  const decoded = decodeTrackingId(trackingId);

  if (!decoded) {
    // Undecodable ID — return a plain 400 rather than redirecting nowhere
    return new NextResponse("Invalid tracking link", { status: 400 });
  }

  // Record click event — best-effort, never block the redirect
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
      event_type: "link_clicked",
      event_at: new Date().toISOString(),
      summary: `Link clicked: ${decoded.originalUrl.slice(0, 200)}`,
      tracking_metadata: {
        original_url: decoded.originalUrl,
        user_agent: userAgent,
        ip,
        sent_at: new Date(decoded.sentAt).toISOString(),
      },
    });
  } catch (err) {
    console.error("[track/click] insert failed:", err);
  }

  return NextResponse.redirect(decoded.originalUrl, { status: 302 });
}
