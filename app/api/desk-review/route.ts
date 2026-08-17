import { NextResponse } from "next/server";
import { disposeReviewRow } from "@/lib/desk/review-queue";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    id?: string;
    disposition?: "matched" | "excluded" | "local_stub" | "waived";
    cleanFirm?: string;
  };
  if (!body.id || !body.disposition) {
    return NextResponse.json({ error: "id and disposition required" }, { status: 400 });
  }
  const row = disposeReviewRow(body.id, body.disposition, { cleanFirm: body.cleanFirm });
  if (!row) return NextResponse.json({ error: "row not found" }, { status: 404 });
  return NextResponse.json({ ok: true, row });
}
