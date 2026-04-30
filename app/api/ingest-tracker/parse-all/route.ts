import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { parseTrackerXlsxAllCampaigns } from "@/lib/ingest/tracker";

/**
 * POST /api/ingest-tracker/parse-all
 *
 * Dry-run for "Import all campaigns" mode. Accepts an xlsx upload with a
 * multi-campaign layout (row 1 = campaign group headers, row 2 = column
 * headers). Detects every campaign column group, resolves each to a DB
 * campaign by fuzzy name-match, and returns one ParsedTracker per matched
 * campaign plus a skip_reason for any group that couldn't be matched.
 *
 * Body: multipart form with:
 *   - file: the xlsx
 */

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string" || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "No file in form body" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 20 MB.` },
        { status: 413 },
      );
    }

    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (ext !== "xlsx" && ext !== "xls" && ext !== "csv") {
      return NextResponse.json(
        { ok: false, error: `Expected .xlsx / .xls / .csv, got .${ext}.` },
        { status: 415 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const result = await parseTrackerXlsxAllCampaigns(buf, file.name);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown parse error";
    console.error("ingest-tracker parse-all failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
