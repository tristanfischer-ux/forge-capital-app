import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { parseTrackerXlsx, applyTrackerIngest, ApplyResult } from "@/lib/ingest/tracker";

/**
 * POST /api/ingest-tracker/apply-all
 *
 * Second leg of "Import all campaigns". Re-parses the xlsx for each
 * campaign in the apply list, then applies the user-approved row
 * selections for each campaign in sequence.
 *
 * Body: multipart form with:
 *   - file: the xlsx (same one the user previewed)
 *   - campaigns: JSON array of per-campaign apply payloads:
 *       [{ campaign_id, apply: [{sheet_name, row_number}, ...] }, ...]
 */

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;

interface CampaignApplyPayload {
  campaign_id: string;
  apply: Array<{ sheet_name: string; row_number: number }>;
}

interface CampaignApplyResult {
  campaign_id: string;
  campaign_name: string;
  result: ApplyResult;
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
    const campaignsJson = form.get("campaigns");

    if (!file || typeof file === "string" || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "No file" }, { status: 400 });
    }
    if (typeof campaignsJson !== "string") {
      return NextResponse.json({ ok: false, error: "campaigns[] required" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "File too large" }, { status: 413 });
    }

    let campaignPayloads: CampaignApplyPayload[];
    try {
      const raw = JSON.parse(campaignsJson);
      if (!Array.isArray(raw)) throw new Error("campaigns must be an array");
      campaignPayloads = raw.map((c) => ({
        campaign_id: String(c?.campaign_id ?? ""),
        apply: Array.isArray(c?.apply)
          ? c.apply
              .map((r: unknown) => ({
                sheet_name: String((r as { sheet_name?: unknown })?.sheet_name ?? ""),
                row_number: Number((r as { row_number?: unknown })?.row_number),
              }))
              .filter((r: { sheet_name: string; row_number: number }) => r.sheet_name && Number.isFinite(r.row_number))
          : [],
      })).filter((c) => c.campaign_id.trim());
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: `Bad campaigns[]: ${err instanceof Error ? err.message : err}` },
        { status: 400 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const results: CampaignApplyResult[] = [];

    for (const payload of campaignPayloads) {
      const parsed = await parseTrackerXlsx(buf, file.name, payload.campaign_id);
      const result = await applyTrackerIngest(parsed, payload.apply);
      results.push({
        campaign_id: payload.campaign_id,
        campaign_name: parsed.campaign_name,
        result,
      });
    }

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown apply error";
    console.error("ingest-tracker apply-all failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
