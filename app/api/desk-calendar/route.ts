import { NextResponse } from "next/server";
import { listWeekAheadCalendar } from "@/lib/capital/live-calendar";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const body = await listWeekAheadCalendar();
    return NextResponse.json({ generated_at: new Date().toISOString(), ...body });
  } catch (err) {
    return NextResponse.json(
      {
        events: [],
        days: [],
        googleOk: false,
        needsCalendarScope: true,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 200 },
    );
  }
}
