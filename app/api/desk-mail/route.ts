import { NextResponse } from "next/server";
import { createGmailDraft, sendGmailMessage } from "@/lib/gmail/create-draft";

export const dynamic = "force-dynamic";

/**
 * Manual mail only. `mode=draft` parks in Gmail Drafts.
 * `mode=send` requires confirm=true and still never runs unattended.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    to?: string;
    subject?: string;
    text?: string;
    mode?: "draft" | "send";
    confirm?: boolean;
    threadId?: string;
  };
  const to = (body.to ?? "").trim();
  const subject = (body.subject ?? "").trim();
  const text = (body.text ?? "").trim();
  if (!to || !subject || !text) {
    return NextResponse.json({ error: "to, subject and text required" }, { status: 400 });
  }
  const mode = body.mode === "send" ? "send" : "draft";
  if (mode === "send" && body.confirm !== true) {
    return NextResponse.json(
      { error: "Manual send requires confirm: true. Nothing auto-sends." },
      { status: 400 },
    );
  }
  try {
    if (mode === "send") {
      const sent = await sendGmailMessage({ to, subject, body: text });
      return NextResponse.json({
        ok: true,
        mode: "send",
        id: sent.id,
        threadId: sent.threadId,
        gmailUrl: `https://mail.google.com/mail/u/0/#sent/${sent.threadId}`,
      });
    }
    const draft = await createGmailDraft({ to, subject, body: text });
    return NextResponse.json({
      ok: true,
      mode: "draft",
      id: draft.id,
      threadId: draft.threadId,
      gmailUrl: `https://mail.google.com/mail/u/0/#drafts/${draft.message.threadId}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
