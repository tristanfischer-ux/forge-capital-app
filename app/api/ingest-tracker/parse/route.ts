import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { parseTrackerXlsx } from "@/lib/ingest/tracker";

/**
 * POST /api/ingest-tracker/parse
 *
 * Dry-run: accepts an xlsx upload + campaign_id, parses the file,
 * fuzzy-matches firms against investors_mirror, stages the proposed
 * insert/update plan. Returns the full ParsedTracker shape so the UI
 * can render the preview table. NO database writes here.
 *
 * Body: multipart form with:
 *   - file: the xlsx
 *   - campaign_id: UUID of the campaign to ingest into
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
    const campaignId = form.get("campaign_id");
    if (!file || typeof file === "string" || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "No file in form body" },
        { status: 400 },
      );
    }
    if (typeof campaignId !== "string" || campaignId.trim() === "") {
      return NextResponse.json(
        { ok: false, error: "campaign_id required" },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 20 MB.`,
        },
        { status: 413 },
      );
    }

    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (ext !== "xlsx" && ext !== "xls" && ext !== "csv") {
      return NextResponse.json(
        {
          ok: false,
          error: `Expected .xlsx / .xls / .csv, got .${ext}.`,
        },
        { status: 415 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = await parseTrackerXlsx(buf, file.name, campaignId);
    return NextResponse.json({ ok: true, parsed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown parse error";
    console.error("ingest-tracker parse failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
