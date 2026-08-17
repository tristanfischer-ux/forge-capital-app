import { NextResponse } from "next/server";
import {
  confirmNotesToAction,
  proposeNotesToAction,
} from "@/lib/desk/notes-to-action";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as { text?: string; confirmId?: string };
  try {
    if (body.confirmId) {
      const run = await confirmNotesToAction(body.confirmId);
      return NextResponse.json({ ok: true, run });
    }
    const text = (body.text ?? "").trim();
    if (text.length < 40) {
      return NextResponse.json({ error: "Paste more than a line." }, { status: 400 });
    }
    const run = await proposeNotesToAction(text);
    return NextResponse.json({ ok: true, run });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
