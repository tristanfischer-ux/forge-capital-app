import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/capital/cron-auth";
import { bumpSyncState } from "@/lib/capital/rpc";
import { buildCanonicalWorkbook } from "@/lib/capital/export-from-db";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const buf = await buildCanonicalWorkbook();
    await bumpSyncState("export");
    return NextResponse.json({
      ok: true,
      bytes: buf.length,
      note: "Workbook built in memory. Storage upload is Phase 6.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await bumpSyncState("export", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
