import { NextResponse } from "next/server";
import { requireTristan } from "@/lib/capital/assert-user";
import { runCalendarBookSync } from "@/app/api/cron/calendar-sync/route";
import { runGmailBookSync } from "@/app/api/cron/gmail-sync/route";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await requireTristan();
  } catch {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  const gmail = await runGmailBookSync();
  const calendar = await runCalendarBookSync();
  return NextResponse.json({ ok: true, gmail, calendar });
}
