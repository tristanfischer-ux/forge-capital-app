import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { parseTrackerXlsx, applyTrackerIngest } from "@/lib/ingest/tracker";

/**
 * POST /api/ingest-tracker/apply
 *
 * Second leg of the ingest. The UI has already called /parse and the
 * user has ticked the rows they want to commit. We re-parse the same
 * xlsx (cheap — it's in memory for this request only) and apply the
 * selected rows. The parsed result and the applyRowNumbers list must
 * together describe EXACTLY what the user approved in the preview UI.
 *
 * Body: multipart form with:
 *   - file: the xlsx (same one the user previewed)
 *   - campaign_id: UUID
 *   - apply: JSON array [{sheet_name, row_number}, ...] of rows to commit
 */

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;

interface ApplySelection {
  sheet_name: string;
  row_number: number;
}

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
    const applyJson = form.get("apply");

    if (!file || typeof file === "string" || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "No file" }, { status: 400 });
    }
    if (typeof campaignId !== "string" || !campaignId.trim()) {
      return NextResponse.json(
        { ok: false, error: "campaign_id required" },
        { status: 400 },
      );
    }
    if (typeof applyJson !== "string") {
      return NextResponse.json(
        { ok: false, error: "apply[] required" },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: "File too large" },
        { status: 413 },
      );
    }

    let applySelection: ApplySelection[];
    try {
      const raw = JSON.parse(applyJson);
      if (!Array.isArray(raw)) throw new Error("apply must be an array");
      applySelection = raw
        .map((r) => ({
          sheet_name: String(r?.sheet_name ?? ""),
          row_number: Number(r?.row_number),
        }))
        .filter((r) => r.sheet_name && Number.isFinite(r.row_number));
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          error: `Bad apply[]: ${err instanceof Error ? err.message : err}`,
        },
        { status: 400 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = await parseTrackerXlsx(buf, file.name, campaignId);
    const result = await applyTrackerIngest(parsed, applySelection);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown apply error";
    console.error("ingest-tracker apply failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
