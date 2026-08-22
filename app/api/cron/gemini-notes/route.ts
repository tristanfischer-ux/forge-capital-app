import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/capital/cron-auth";
import { ingestGeminiNotes } from "@/lib/capital/gemini-notes";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await ingestGeminiNotes(10);
  return NextResponse.json({ message: "gemini notes ingest", ...result });
}
