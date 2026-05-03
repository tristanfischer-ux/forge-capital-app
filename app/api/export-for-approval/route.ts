import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createServerClient } from "@/lib/supabase/server";

/**
 * GET /api/export-for-approval?c=<campaignId>
 *
 * Exports an Excel file of pending partners (status_code = '+0') for a
 * campaign. The file is sent to the browser for download.
 *
 * Columns:
 *   A: Partner name (from partners_mirror)
 *   B: Firm name (from investors_mirror via partner's investor_id)
 *   C: Why-them summary (from investment_pattern or connection_brief)
 *   D: Email status (email_tier from partners_mirror)
 *   E: Decision — blank, for the reviewer to fill: "yes", "no", or "skip"
 *   F: Reviewer notes — blank, for optional comments
 *
 * Security: requires authenticated session (RLS-scoped).
 */

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not signed in" },
        { status: 401 },
      );
    }

    const campaignId = req.nextUrl.searchParams.get("c");
    if (!campaignId) {
      return NextResponse.json(
        { ok: false, error: "Missing campaign id (?c=)" },
        { status: 400 },
      );
    }

    // Fetch campaign name for the title row
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("name")
      .eq("id", campaignId)
      .single();

    const campaignName = campaign?.name ?? "Campaign";

    // Fetch pending partners (+0) with joined mirror data
    const { data: rows, error } = await supabase
      .from("campaign_partners")
      .select(
        `
        id,
        created_at,
        partners_mirror:partner_id (
          name,
          title,
          kind,
          email_tier,
          investors_mirror:investor_id (
            firm_name,
            hq_location,
            synthesis_data,
            investment_pattern,
            connection_brief,
            team_expertise
          ),
          customers_mirror:customer_id (
            firm_name,
            pitch_hook
          )
        )
      `,
      )
      .eq("campaign_id", campaignId)
      .eq("status_code", "+0")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("export-for-approval query error:", error.message);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No pending partners to export" },
        { status: 404 },
      );
    }

    // Build workbook
    const wb = XLSX.utils.book_new();

    // Title row data
    const today = new Date().toISOString().slice(0, 10);
    const titleData = [
      [`Approval sheet — ${campaignName} — ${today}`],
      [`${rows.length} partner${rows.length === 1 ? "" : "s"} awaiting decision`],
      [],
    ];

    // Header row
    const headers = [
      "Partner name",
      "Firm name",
      "Why them (synthesis)",
      "Email status",
      "Decision",
      "Reviewer notes",
    ];

    // Data rows
    type JoinRow = {
      id: string;
      created_at: string | null;
      partners_mirror: {
        name: string | null;
        title: string | null;
        kind: string | null;
        email_tier: string | null;
        investors_mirror: {
          firm_name: string | null;
          hq_location: string | null;
          synthesis_data: unknown;
          investment_pattern: string | null;
          connection_brief: string | null;
          team_expertise: string | null;
        } | null;
        customers_mirror: {
          firm_name: string | null;
          pitch_hook: string | null;
        } | null;
      } | null;
    };

    const dataRows = (rows as unknown as JoinRow[]).map((row) => {
      const partner = row.partners_mirror;
      const investor = partner?.investors_mirror;
      const customer = partner?.customers_mirror;
      const isCustomer = partner?.kind === "customer";

      // Best available "why them" synthesis — mirrors approval.ts logic
      let whyThem: string;
      if (isCustomer) {
        whyThem = customer?.pitch_hook ?? "";
      } else {
        // Use deriveWhyThem logic: investment_pattern > connection_brief > team_expertise
        whyThem =
          investor?.investment_pattern ||
          investor?.connection_brief ||
          investor?.team_expertise ||
          "";
        // Fallback to synthesis_data jsonb
        if (!whyThem && investor?.synthesis_data) {
          const sd = investor.synthesis_data as Record<string, unknown>;
          for (const key of ["why_them", "connection", "intelligent_synthesis"]) {
            const v = sd[key];
            if (typeof v === "string" && v.trim().length > 0) {
              whyThem = v.trim();
              break;
            }
          }
        }
      }

      // Firm name
      const firmName = isCustomer
        ? customer?.firm_name ?? "—"
        : investor?.firm_name ?? "—";

      // Email tier display
      const emailStatus = partner?.email_tier
        ? formatEmailTier(partner.email_tier)
        : "Unverified";

      return [
        partner?.name ?? "—",
        firmName,
        whyThem,
        emailStatus,
        "", // Decision — blank for reviewer
        "", // Reviewer notes — blank
      ];
    });

    // Combine title + headers + data
    const sheetData = [...titleData, headers, ...dataRows];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Set column widths
    ws["!cols"] = [
      { wch: 28 }, // Partner name
      { wch: 30 }, // Firm name
      { wch: 50 }, // Why them
      { wch: 16 }, // Email status
      { wch: 12 }, // Decision
      { wch: 30 }, // Reviewer notes
    ];

    // Merge title rows across all columns
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "For approval");

    // Generate buffer
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    // Return as downloadable file
    const filename = `approval-${campaignName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${today}.xlsx`;

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown export error";
    console.error("export-for-approval failed:", msg);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 },
    );
  }
}

/** Human-readable email tier label */
function formatEmailTier(tier: string): string {
  const labels: Record<string, string> = {
    corresponded: "Corresponded",
    hunter_verified: "Hunter verified",
    neverbounce_valid: "Valid",
    neverbounce_catchall: "Catch-all",
    neverbounce_unknown: "Unknown",
    unverified: "Unverified",
    generic_blocked: "Generic (blocked)",
    neverbounce_invalid: "Invalid",
    neverbounce_disposable: "Disposable",
    bounced: "Bounced",
  };
  return labels[tier] ?? tier;
}
