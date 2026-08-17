import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { loadMeetingBriefs, saveMeetingNote } from "@/lib/queries/meeting-brief";

export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = (await request.json()) as { meetingId?: string; text?: string };
  const meetingId = (body.meetingId ?? "").trim();
  const text = (body.text ?? "").trim();
  if (!meetingId) return NextResponse.json({ error: "meetingId required" }, { status: 400 });

  saveMeetingNote(meetingId, text);

  const brief = loadMeetingBriefs()[meetingId];
  if (brief?.campaign_partner_id && text) {
    await supabase.from("contact_events").insert({
      campaign_partner_id: brief.campaign_partner_id,
      direction: "note",
      channel: "manual",
      event_type: "personal_note",
      event_at: new Date().toISOString(),
      summary: text.slice(0, 2000),
      title: "Meeting note",
    });
  }

  return NextResponse.json({ ok: true });
}
