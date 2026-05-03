"use server";

import * as XLSX from "xlsx";
import { createServerClient } from "@/lib/supabase/server";
import { refreshOutreachState } from "./outreach-state-actions";

/**
 * Server action: import decisions from an uploaded Excel file.
 *
 * The Excel should have been exported via /api/export-for-approval,
 * filled in by the reviewer, then uploaded back. This action:
 *
 *   1. Parses the Excel file
 *   2. Matches rows by partner name + firm name (case-insensitive)
 *   3. Updates campaign_partners.status_code based on the Decision column:
 *      - "yes" → +1 (Approved)
 *      - "no" → -1 (Declined)
 *      - "skip" or blank → no change
 *   4. Fires sync_investor_outreach_state() afterwards
 *   5. Returns a summary of what changed
 *
 * SECURITY: requires authenticated session. Only processes status_code
 * updates — never touches scheduled_sends or outbound email paths.
 */

export interface ImportResult {
  ok: boolean;
  approved: number;
  declined: number;
  skipped: number;
  notFound: number;
  errors: string[];
}

export async function importApprovalDecisions({
  campaignId,
  fileBase64,
  fileName,
}: {
  campaignId: string;
  fileBase64: string;
  fileName: string;
}): Promise<ImportResult> {
  const result: ImportResult = {
    ok: false,
    approved: 0,
    declined: 0,
    skipped: 0,
    notFound: 0,
    errors: [],
  };

  if (!campaignId) {
    result.errors.push("Missing campaign id");
    return result;
  }

  if (!fileBase64) {
    result.errors.push("No file data provided");
    return result;
  }

  try {
    // Auth check
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      result.errors.push("Not signed in");
      return result;
    }

    // Parse the Excel file
    const buf = Buffer.from(fileBase64, "base64");
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      result.errors.push("Excel file has no sheets");
      return result;
    }

    const sheet = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

    if (raw.length < 4) {
      result.errors.push("Excel file is empty or has no data rows");
      return result;
    }

    // Find the header row (contains "Decision" or "Partner name")
    let headerIdx = -1;
    for (let i = 0; i < Math.min(raw.length, 10); i++) {
      const row = raw[i];
      if (Array.isArray(row)) {
        const hasDecision = row.some(
          (cell) =>
            typeof cell === "string" &&
            cell.toLowerCase().includes("decision"),
        );
        const hasPartner = row.some(
          (cell) =>
            typeof cell === "string" &&
            cell.toLowerCase().includes("partner"),
        );
        if (hasDecision && hasPartner) {
          headerIdx = i;
          break;
        }
      }
    }

    if (headerIdx === -1) {
      result.errors.push(
        "Could not find header row (expected 'Partner name' and 'Decision' columns)",
      );
      return result;
    }

    const headers = raw[headerIdx] as string[];
    const partnerCol = headers.findIndex(
      (h) => typeof h === "string" && h.toLowerCase().includes("partner"),
    );
    const firmCol = headers.findIndex(
      (h) => typeof h === "string" && h.toLowerCase().includes("firm"),
    );
    const decisionCol = headers.findIndex(
      (h) => typeof h === "string" && h.toLowerCase().includes("decision"),
    );

    if (partnerCol === -1 || decisionCol === -1) {
      result.errors.push(
        "Missing required columns (Partner name, Decision)",
      );
      return result;
    }

    // Data rows start after header
    const dataRows = raw.slice(headerIdx + 1);

    // Fetch all campaign_partners with their mirror data for matching
    const { data: campaignPartners } = await supabase
      .from("campaign_partners")
      .select(
        `
        id,
        partner_id,
        status_code,
        partners_mirror:partner_id (
          id,
          name,
          investors_mirror:investor_id (
            firm_name
          )
        )
      `,
      )
      .eq("campaign_id", campaignId)
      .in("status_code", ["+0", "-1"]); // Only pending or already declined

    if (!campaignPartners || campaignPartners.length === 0) {
      result.errors.push("No pending partners found in this campaign");
      return result;
    }

    // Build lookup: partner name + firm name → campaign_partner id
    type CPRow = {
      id: string;
      partner_id: number;
      status_code: string;
      partners_mirror: {
        id: number;
        name: string | null;
        investors_mirror: {
          firm_name: string | null;
        } | null;
      } | null;
    };

    const lookup = new Map<string, string>(); // "name|firm" → campaign_partner.id
    for (const cp of campaignPartners as unknown as CPRow[]) {
      const partnerName = (cp.partners_mirror?.name ?? "").toLowerCase().trim();
      const firmName = (
        cp.partners_mirror?.investors_mirror?.firm_name ?? ""
      )
        .toLowerCase()
        .trim();
      if (partnerName) {
        lookup.set(`${partnerName}|${firmName}`, cp.id);
      }
    }

    // Process each data row
    const toUpdate: { id: string; statusCode: string; statusLabel: string }[] =
      [];

    for (const row of dataRows) {
      if (!Array.isArray(row)) continue;

      const partnerName = String(row[partnerCol] ?? "")
        .toLowerCase()
        .trim();
      const firmName = firmCol >= 0 ? String(row[firmCol] ?? "").toLowerCase().trim() : "";
      const decision = String(row[decisionCol] ?? "")
        .toLowerCase()
        .trim();

      if (!partnerName || !decision) {
        if (decision) result.skipped++; // Has decision but no partner name
        continue;
      }

      if (decision === "skip" || decision === "") {
        result.skipped++;
        continue;
      }

      // Try exact match first, then partner-only fallback
      let cpId = lookup.get(`${partnerName}|${firmName}`);
      if (!cpId && firmName) {
        // Fallback: match by partner name only (firm might differ slightly)
        for (const [key, id] of lookup) {
          const [ln] = key.split("|");
          if (ln === partnerName) {
            cpId = id;
            break;
          }
        }
      }

      if (!cpId) {
        result.notFound++;
        continue;
      }

      if (decision === "yes") {
        toUpdate.push({
          id: cpId,
          statusCode: "+1",
          statusLabel: "Approved",
        });
      } else if (decision === "no") {
        toUpdate.push({
          id: cpId,
          statusCode: "-1",
          statusLabel: "Declined",
        });
      } else {
        result.skipped++;
      }
    }

    // Bulk update in batches of 100
    const BATCH = 100;
    for (let i = 0; i < toUpdate.length; i += BATCH) {
      const batch = toUpdate.slice(i, i + BATCH);

      // Process each update individually since we need different status codes
      for (const update of batch) {
        const { error } = await supabase
          .from("campaign_partners")
          .update({
            status_code: update.statusCode,
            status_label: update.statusLabel,
            updated_at: new Date().toISOString(),
          })
          .eq("id", update.id);

        if (error) {
          result.errors.push(
            `Failed to update partner ${update.id}: ${error.message}`,
          );
        } else {
          if (update.statusCode === "+1") result.approved++;
          else if (update.statusCode === "-1") result.declined++;
        }
      }
    }

    // Sync cross-campaign outreach state
    if (result.approved > 0 || result.declined > 0) {
      try {
        await refreshOutreachState();
      } catch {
        // Non-critical — state will sync on next call
      }
    }

    result.ok = result.errors.length === 0;
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown import error";
    console.error("import-approval-decisions failed:", msg);
    result.errors.push(msg);
    return result;
  }
}
