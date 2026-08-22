import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/capital/cron-auth";
import { runSentMailSweep } from "@/lib/gmail/sent-sweep";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runSentMailSweep();
  return NextResponse.json(result);
}
