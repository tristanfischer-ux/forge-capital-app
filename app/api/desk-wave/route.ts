import { NextResponse } from "next/server";
import { createGmailDraft } from "@/lib/gmail/create-draft";
import { principalPacket, screenWave } from "@/lib/desk/wave";
import { listActiveCampaigns } from "@/lib/queries/campaigns";
import { getTrackerRows } from "@/lib/queries/tracker";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    campaignId?: string;
    action?: "packet" | "drafts";
    ids?: string[];
  };
  const campaignId = body.campaignId ?? "";
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  const campaigns = await listActiveCampaigns();
  const camp = campaigns.find((c) => c.id === campaignId);
  if (!camp) return NextResponse.json({ error: "unknown raise" }, { status: 404 });

  const rows = await getTrackerRows(campaignId);
  const screened = screenWave(rows);

  if (body.action === "packet") {
    const to = camp.counterpart_email;
    if (!to) {
      return NextResponse.json(
        { error: "This raise has no principal email on file. Add one on the campaign, then retry." },
        { status: 400 },
      );
    }
    const packet = principalPacket({
      raise: camp.display_name ?? camp.name,
      principalName: camp.counterpart_name,
      rows: screened,
    });
    const draft = await createGmailDraft({
      to,
      subject: packet.subject,
      body: packet.body,
    });
    return NextResponse.json({
      ok: true,
      mode: "packet",
      to,
      id: draft.id,
      gmailUrl: `https://mail.google.com/mail/u/0/#drafts/${draft.message.threadId}`,
    });
  }

  if (body.action === "drafts") {
    const want = new Set(body.ids ?? []);
    const pool = screened.filter(
      (r) =>
        r.flag !== "red" &&
        r.email &&
        (want.size === 0 ? r.status === "+1" || r.status === "+0" : want.has(r.id)),
    );
    const made: { to: string; id: string }[] = [];
    const failed: { to: string; error: string }[] = [];
    const raise = camp.display_name ?? camp.name;
    for (const r of pool.slice(0, 40)) {
      try {
        const draft = await createGmailDraft({
          to: r.email as string,
          subject: `${raise} — 20 minutes`,
          body: `Dear ${r.name.split(" ")[0]},\n\nMy name is Tristan Fischer. For the past twenty-five years I have designed, financed and built capital-intensive industrial technology businesses.\n\nI am writing about ${raise}. Would you have 20 minutes in the next few days?\nhttps://calendly.com/tristan-fischer-wjlf/30min\n\nBest regards,\nTristan Fischer\ntristan.fischer@gmail.com\n+44 7776191944\nhttps://www.linkedin.com/in/tristanfischer/\nThought pieces: www.historyfuturenow.com\n`,
          campaignPartnerId: r.id,
        });
        made.push({ to: r.email as string, id: draft.id });
      } catch (err) {
        failed.push({
          to: r.email as string,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return NextResponse.json({
      ok: true,
      mode: "drafts",
      made: made.length,
      failed: failed.length,
      details: { made, failed },
    });
  }

  return NextResponse.json({ error: "action must be packet or drafts" }, { status: 400 });
}
