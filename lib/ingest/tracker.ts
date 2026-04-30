import * as XLSX from "xlsx";
import { createServerClient } from "@/lib/supabase/server";
import { STATUS_CODES, STATUS_BY_CODE, labelFor } from "@/lib/status-codes";

/**
 * Tracker xlsx ingest — parses Tristan's Excel tracker (the one Claude
 * Co-work has been writing to) and stages the updates against
 * campaign_partners / partners_mirror / investors_mirror. The ingest is
 * idempotent and preview-first: no database writes until the caller
 * explicitly asks to apply.
 *
 * Column detection is fuzzy. The tracker xlsx isn't strictly formatted,
 * so we look at the header row and match by keyword against a known
 * alias list. Missing columns degrade gracefully (we just don't update
 * that field).
 *
 * Fuzzy-match firm_name against `investors_mirror`:
 *   1. case-insensitive exact
 *   2. normalised substring (drop punctuation, legal suffixes)
 *   3. token subset
 * Same shape as the approval-reply parser's match_firm — deliberately.
 *
 * Shape of the ingest result (ParsedTracker):
 *   - rows                 — one per spreadsheet row
 *   - matched_count        — rows that matched an investor
 *   - unmatched_count      — rows we couldn't match (show firm + reason)
 *   - campaign_partner_ids — existing tracker rows that would be touched
 *   - new_campaign_partner_count — rows that would be inserted (no existing)
 */

export interface ParsedTrackerRow {
  /** 1-based row number in the sheet (excluding header). */
  row_number: number;
  sheet_name: string;
  /** Raw values read from detected columns — null when the column
   *  wasn't present or the cell was empty. */
  firm_name: string | null;
  contact_name: string | null;
  email: string | null;
  status_code: string | null;
  status_label: string | null;
  commentary: string | null;
  last_contact_at: string | null; // ISO date
  /** Match result against investors_mirror. `null` when no reasonable
   *  match was found. */
  matched_investor_id: number | null;
  matched_investor_firm: string | null;
  match_reason: "exact" | "contains" | "token_subset" | "ambiguous" | "none";
  /** Pre-existing tracker row we'd update, or null for a new insert. */
  existing_campaign_partner_id: string | null;
  /** Current DB values for the existing row — used during apply to merge
   *  correctly. All null when this is a new insert. */
  existing_status_code: string | null;
  existing_commentary: string | null;
  existing_last_contact_at: string | null;
  /** What the final upsert would look like — shown to user for confirm. */
  planned_action: "insert" | "update" | "skip_no_match" | "skip_ambiguous";
  /** Warnings attached to this row — stale commentary, status-code
   *  downgrade, etc. */
  warnings: string[];
}

export interface ParsedTracker {
  campaign_id: string;
  campaign_name: string;
  filename: string;
  sheet_names: string[];
  rows: ParsedTrackerRow[];
  matched_count: number;
  unmatched_count: number;
  ambiguous_count: number;
  new_campaign_partner_count: number;
  update_count: number;
  /** Count of unique investors in investors_mirror that ARE actively
   *  deploying but don't appear in the uploaded sheet (for the user's
   *  awareness — "are you missing rows?"). */
  missing_from_sheet: number;
}

// ── Header detection ──────────────────────────────────────────────────

const HEADER_ALIASES: Record<string, string[]> = {
  firm_name: [
    "firm", "firm name", "company", "investor", "fund", "investor name",
    "vc", "fund name", "name",
  ],
  contact_name: [
    "contact", "partner", "contact name", "primary contact", "person",
    "named partner", "partner name", "counterpart",
  ],
  email: ["email", "email address", "e-mail", "mail"],
  status: [
    "status", "stage", "state", "status code", "code", "status_code",
    "sw", // shorthand for Stephan / approver comment column
    "current",
  ],
  commentary: [
    "commentary", "notes", "comments", "note", "comment", "remarks",
    "log", "history",
  ],
  last_contact_at: [
    "last contact", "last contacted", "date", "last email", "contact date",
    "last touch", "last_contact_at", "latest", "first sent",
  ],
};

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Detect a multi-campaign layout: row 1 has group headers like
 *  "SKYSAILS POWER", "FISHFROM", "PANATERE" that span column ranges.
 *  Returns null for single-campaign sheets. */
interface CampaignColumnGroup {
  groupName: string;
  startCol: number;
  endCol: number; // exclusive
}

function detectMultiCampaignGroups(
  row1: unknown[],
): CampaignColumnGroup[] | null {
  const groups: CampaignColumnGroup[] = [];
  let lastNonEmpty = -1;

  for (let i = 0; i < row1.length; i++) {
    const val = cellToString(row1[i]);
    if (val) {
      if (lastNonEmpty >= 0 && groups.length > 0) {
        groups[groups.length - 1].endCol = i;
      }
      groups.push({ groupName: val, startCol: i, endCol: row1.length });
      lastNonEmpty = i;
    }
  }

  // Need at least 2 groups to be multi-campaign (e.g. "INVESTOR INFO" + one campaign group)
  if (groups.length < 2) return null;

  // Check if any group header looks like a campaign (not "INVESTOR INFO")
  const investorInfoAliases = ["investor info", "investor", "info", "shared"];
  const campaignGroups = groups.filter(
    (g) => !investorInfoAliases.includes(normHeader(g.groupName)),
  );
  if (campaignGroups.length < 1) return null;

  return groups;
}

/** Fuzzy-match a campaign name against group headers.
 *  "SkySails" matches "SKYSAILS POWER", "FishFrom" matches "FISHFROM", etc. */
function matchCampaignToGroup(
  campaignName: string,
  groups: CampaignColumnGroup[],
): CampaignColumnGroup | null {
  const normCampaign = normHeader(campaignName);
  // Exact normalised match
  for (const g of groups) {
    if (normHeader(g.groupName) === normCampaign) return g;
  }
  // Either contains the other
  for (const g of groups) {
    const normGroup = normHeader(g.groupName);
    if (normGroup.includes(normCampaign) || normCampaign.includes(normGroup)) {
      return g;
    }
  }
  // Token subset: all campaign tokens appear in the group header
  const campaignTokens = normCampaign.split(" ").filter((t) => t.length >= 2);
  for (const g of groups) {
    const groupTokens = new Set(normHeader(g.groupName).split(" ").filter((t) => t.length >= 2));
    if (campaignTokens.length > 0 && campaignTokens.every((t) => groupTokens.has(t))) {
      return g;
    }
  }
  return null;
}

function detectColumns(
  headers: string[],
  scopeStart?: number,
  scopeEnd?: number,
): Record<string, number | null> {
  const out: Record<string, number | null> = {
    firm_name: null,
    contact_name: null,
    email: null,
    status: null,
    commentary: null,
    last_contact_at: null,
  };
  const normed = headers.map(normHeader);
  const lo = scopeStart ?? 0;
  const hi = scopeEnd ?? headers.length;

  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    // Per-campaign fields (status, commentary, last_contact_at) search within scope only.
    // Shared fields (firm_name, contact_name, email) search everywhere.
    const isPerCampaign = key === "status" || key === "commentary" || key === "last_contact_at";
    const searchLo = isPerCampaign ? lo : 0;
    const searchHi = isPerCampaign ? hi : headers.length;

    // First pass: exact match against normalised header within scope.
    let idx = -1;
    for (let i = searchLo; i < searchHi; i++) {
      if (aliases.includes(normed[i])) { idx = i; break; }
    }
    if (idx < 0) {
      // Second pass: any alias appears as a substring within scope.
      for (let i = searchLo; i < searchHi; i++) {
        if (aliases.some((a) => a !== "name" && normed[i].includes(a))) {
          idx = i;
          break;
        }
      }
    }
    out[key] = idx >= 0 ? idx : null;
  }
  return out;
}

// ── Status parsing ────────────────────────────────────────────────────

/** Return a canonical status code ("+3", "-1", etc.) from a free-text
 *  cell. Handles "+3 Email sent", "3", "email sent", "Email Sent",
 *  "Reject" → "-1", etc. Returns null on no match. */
function parseStatusCell(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.toString().trim();
  if (!s) return null;

  // Direct code match: +3, -1, +10 anywhere in the string.
  const codeMatch = s.match(/[+\-]\d{1,2}/);
  if (codeMatch && STATUS_BY_CODE[codeMatch[0]]) return codeMatch[0];

  // Label match — normalise and compare against each known label.
  const normed = normHeader(s);
  for (const def of STATUS_CODES) {
    if (normed === normHeader(def.label)) return def.code;
  }
  // Substring match — "email sent" inside "+3 Email sent this morning".
  for (const def of STATUS_CODES) {
    if (normed.includes(normHeader(def.label))) return def.code;
  }
  // Common abbreviations.
  if (/^reject|decline|pass/.test(normed)) return "-1";
  if (/^bounce/.test(normed)) return "-2";
  if (/^disqualif/.test(normed)) return "-3";
  if (/^approve/.test(normed)) return "+1";
  if (/^meeting/.test(normed)) return "+8";
  if (/^reply|response/.test(normed)) return "+6";
  if (/^follow.?up/.test(normed)) return "+5";
  if (/^sent|email sent/.test(normed)) return "+3";
  return null;
}

// ── Firm-name fuzzy match ─────────────────────────────────────────────

const LEGAL_SUFFIXES = /\b(llc|ltd|inc|gmbh|bv|plc|co|llp|sarl|ab|ag|sa|spa|vc|ventures|capital|partners|fund|funds|holdings)\b/gi;

function normFirm(s: string): string {
  return s
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenise(s: string): Set<string> {
  return new Set(normFirm(s).split(" ").filter((t) => t.length >= 2));
}

function matchFirm(
  query: string,
  candidates: Array<{ id: number; firm_name: string }>,
): {
  match: { id: number; firm_name: string } | null;
  reason: ParsedTrackerRow["match_reason"];
} {
  const q = normFirm(query);
  if (!q) return { match: null, reason: "none" };

  // Exact (normalised)
  const exact = candidates.filter((c) => normFirm(c.firm_name) === q);
  if (exact.length === 1) return { match: exact[0], reason: "exact" };
  if (exact.length > 1) return { match: null, reason: "ambiguous" };

  // Contains
  const contains = candidates.filter((c) => {
    const n = normFirm(c.firm_name);
    return n.includes(q) || q.includes(n);
  });
  if (contains.length === 1) return { match: contains[0], reason: "contains" };
  if (contains.length > 1) {
    contains.sort((a, b) => a.firm_name.length - b.firm_name.length);
    if (contains.length >= 2 && contains[0].firm_name.length === contains[1].firm_name.length) {
      return { match: null, reason: "ambiguous" };
    }
    return { match: contains[0], reason: "contains" };
  }

  // Token subset
  const qTokens = tokenise(query);
  if (qTokens.size === 0) return { match: null, reason: "none" };
  const hits = candidates.filter((c) => {
    const cTokens = tokenise(c.firm_name);
    for (const t of qTokens) if (!cTokens.has(t)) return false;
    return true;
  });
  if (hits.length === 1) return { match: hits[0], reason: "token_subset" };
  if (hits.length > 1) return { match: null, reason: "ambiguous" };

  return { match: null, reason: "none" };
}

// ── Cell reading helpers ──────────────────────────────────────────────

function cellToString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s === "" ? null : s;
  }
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function parseDateCell(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") {
    // Excel serial date — approximate conversion via SheetJS's excel-to-JS.
    const date = XLSX.SSF.parse_date_code(v);
    if (!date) return null;
    // SSF.parse_date_code returns {y, m, d, H, M, S}.
    const iso = new Date(
      Date.UTC(date.y, (date.m ?? 1) - 1, date.d ?? 1, date.H ?? 0, date.M ?? 0, date.S ?? 0),
    ).toISOString();
    return iso;
  }
  const s = cellToString(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// ── Main parser ───────────────────────────────────────────────────────

export async function parseTrackerXlsx(
  buffer: Buffer,
  filename: string,
  campaignId: string,
): Promise<ParsedTracker> {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });

  const supabase = await createServerClient();

  // Fetch what we need to match / merge against.
  const [campaignRes, investorRes, cpRes] = await Promise.all([
    supabase.from("campaigns").select("id, name").eq("id", campaignId).maybeSingle(),
    supabase.from("investors_mirror").select("id, firm_name").eq("actively_deploying", true).limit(15000),
    supabase
      .from("campaign_partners")
      .select("id, partner_id, status_code, approver_note, last_contact_at, partners_mirror:partner_id(investor_id)")
      .eq("campaign_id", campaignId),
  ]);

  if (!campaignRes.data) throw new Error("Campaign not found");
  const campaignName = campaignRes.data.name as string;

  const allInvestors = ((investorRes.data ?? []) as Array<{ id: number; firm_name: string | null }>)
    .filter((r): r is { id: number; firm_name: string } => !!r.firm_name);

  // Build an index from investor_id → existing campaign_partners row.
  const existingByInvestor = new Map<
    number,
    { id: string; status_code: string | null; approver_note: string | null; last_contact_at: string | null }
  >();
  for (const row of (cpRes.data ?? []) as unknown as Array<{
    id: string;
    status_code: string | null;
    approver_note: string | null;
    last_contact_at: string | null;
    partners_mirror: { investor_id: number } | null;
  }>) {
    const invId = row.partners_mirror?.investor_id;
    if (typeof invId === "number") {
      existingByInvestor.set(invId, {
        id: row.id,
        status_code: row.status_code,
        approver_note: row.approver_note,
        last_contact_at: row.last_contact_at,
      });
    }
  }

  const allRows: ParsedTrackerRow[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    // header:1 → array-of-arrays; first row is headers.
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: null });
    if (aoa.length < 2) continue; // empty sheet

    // Multi-campaign detection: check if row 1 has campaign group headers.
    const row1 = aoa[0] as unknown[];
    const multiGroups = detectMultiCampaignGroups(row1);

    let headers: string[];
    let dataStartRow: number;
    let cols: Record<string, number | null>;

    if (multiGroups) {
      // Row 1 = group headers, row 2 = column headers. Data starts at row 3 (index 2).
      if (aoa.length < 3) continue;
      headers = (aoa[1] as unknown[]).map((h) => cellToString(h) ?? "");
      dataStartRow = 2;

      // Find the column group matching the active campaign.
      const matchedGroup = matchCampaignToGroup(campaignName, multiGroups);
      if (matchedGroup) {
        cols = detectColumns(headers, matchedGroup.startCol, matchedGroup.endCol);
      } else {
        // Campaign not found in group headers — fall back to first non-info group
        // and add a warning. Still detect shared columns (firm, contact, email) globally.
        const investorInfoAliases = ["investor info", "investor", "info", "shared"];
        const firstCampaignGroup = multiGroups.find(
          (g) => !investorInfoAliases.includes(normHeader(g.groupName)),
        );
        if (firstCampaignGroup) {
          cols = detectColumns(headers, firstCampaignGroup.startCol, firstCampaignGroup.endCol);
        } else {
          cols = detectColumns(headers);
        }
      }
    } else {
      // Single-campaign sheet — original behaviour.
      headers = (aoa[0] as unknown[]).map((h) => cellToString(h) ?? "");
      dataStartRow = 1;
      cols = detectColumns(headers);
    }

    // No firm column = unusable sheet.
    if (cols.firm_name === null) continue;

    for (let i = dataStartRow; i < aoa.length; i++) {
      const r = aoa[i] as unknown[];
      if (!r) continue;
      const firm = cols.firm_name !== null ? cellToString(r[cols.firm_name]) : null;
      if (!firm) continue; // skip blank rows

      const rawStatus = cols.status !== null ? cellToString(r[cols.status]) : null;
      const code = parseStatusCell(rawStatus);
      const commentary = cols.commentary !== null ? cellToString(r[cols.commentary]) : null;
      const contact = cols.contact_name !== null ? cellToString(r[cols.contact_name]) : null;
      const email = cols.email !== null ? cellToString(r[cols.email]) : null;
      const lastContact = cols.last_contact_at !== null ? parseDateCell(r[cols.last_contact_at]) : null;

      const { match, reason } = matchFirm(firm, allInvestors);

      const warnings: string[] = [];
      const existing = match ? existingByInvestor.get(match.id) ?? null : null;

      let plannedAction: ParsedTrackerRow["planned_action"];
      if (!match) {
        plannedAction = reason === "ambiguous" ? "skip_ambiguous" : "skip_no_match";
      } else if (existing) {
        // Would update an existing row. Flag status-code downgrades
        // (e.g. +8 Meeting scheduled → +3 Email sent) as suspicious.
        if (existing.status_code && code && statusCodeRank(code) < statusCodeRank(existing.status_code)) {
          warnings.push(
            `Status downgrade: ${existing.status_code} → ${code}. Upload says earlier stage than DB; you probably don't want this.`,
          );
        }
        plannedAction = "update";
      } else {
        plannedAction = "insert";
      }

      allRows.push({
        row_number: i,
        sheet_name: sheetName,
        firm_name: firm,
        contact_name: contact,
        email,
        status_code: code,
        status_label: labelFor(code),
        commentary,
        last_contact_at: lastContact,
        matched_investor_id: match?.id ?? null,
        matched_investor_firm: match?.firm_name ?? null,
        match_reason: reason,
        existing_campaign_partner_id: existing?.id ?? null,
        existing_status_code: existing?.status_code ?? null,
        existing_commentary: existing?.approver_note ?? null,
        existing_last_contact_at: existing?.last_contact_at ?? null,
        planned_action: plannedAction,
        warnings,
      });
    }
  }

  const matched = allRows.filter((r) => r.matched_investor_id !== null).length;
  const ambiguous = allRows.filter((r) => r.match_reason === "ambiguous").length;
  const unmatched = allRows.filter(
    (r) => r.matched_investor_id === null && r.match_reason !== "ambiguous",
  ).length;
  const newCount = allRows.filter((r) => r.planned_action === "insert").length;
  const updateCount = allRows.filter((r) => r.planned_action === "update").length;

  // "Missing from sheet" = investors in DB for this campaign that AREN'T
  // represented in the uploaded sheet. Signals the user might have an
  // older sheet version that's dropped some rows.
  const sheetInvestorIds = new Set(
    allRows.map((r) => r.matched_investor_id).filter((v): v is number => v !== null),
  );
  let missingFromSheet = 0;
  for (const invId of existingByInvestor.keys()) {
    if (!sheetInvestorIds.has(invId)) missingFromSheet++;
  }

  return {
    campaign_id: campaignId,
    campaign_name: campaignName,
    filename,
    sheet_names: wb.SheetNames,
    rows: allRows,
    matched_count: matched,
    unmatched_count: unmatched,
    ambiguous_count: ambiguous,
    new_campaign_partner_count: newCount,
    update_count: updateCount,
    missing_from_sheet: missingFromSheet,
  };
}

const STATUS_RANK: Record<string, number> = Object.fromEntries(
  STATUS_CODES.map((s, i) => [s.code, STATUS_CODES.length - i]),
);
function statusCodeRank(code: string | null): number {
  if (!code) return -1;
  return STATUS_RANK[code] ?? -1;
}

// ── All-campaigns parse ───────────────────────────────────────────────

export interface AllCampaignsParsed {
  filename: string;
  /** One entry per detected campaign column group. */
  campaigns: Array<{
    /** The raw group header from row 1 of the spreadsheet. */
    group_name: string;
    /** Matched DB campaign, or null when no campaign in the DB fuzzy-matches. */
    campaign_id: string | null;
    campaign_name: string | null;
    /** Full parse result, or null when campaign_id is null. */
    parsed: ParsedTracker | null;
    /** Human-readable reason when we couldn't map the group to a DB campaign. */
    skip_reason: string | null;
  }>;
  /** Group headers that look like "INVESTOR INFO" — shared columns, skipped. */
  skipped_info_groups: string[];
}

/**
 * Parse a multi-campaign xlsx in a single pass.
 *
 * Detects the campaign column groups from row 1, resolves each group to a
 * campaign in the DB by fuzzy name-match, then calls parseTrackerXlsx for
 * each matched campaign. Investor-info groups (the shared A-D columns) are
 * detected and skipped.
 *
 * Returns an AllCampaignsParsed with one entry per campaign group, whether
 * matched or not, so the UI can surface "PANATERE — no matching campaign in
 * DB" alongside successful parses.
 */
export async function parseTrackerXlsxAllCampaigns(
  buffer: Buffer,
  filename: string,
): Promise<AllCampaignsParsed> {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });

  const supabase = await createServerClient();

  // Fetch all campaigns once.
  const { data: allCampaigns } = await supabase
    .from("campaigns")
    .select("id, name");
  const campaigns = (allCampaigns ?? []) as Array<{ id: string; name: string }>;

  const investorInfoAliases = ["investor info", "investor", "info", "shared"];

  const result: AllCampaignsParsed = {
    filename,
    campaigns: [],
    skipped_info_groups: [],
  };

  // We only need to detect groups once — use the first sheet that has a
  // multi-campaign row 1.
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: null });
    if (aoa.length < 2) continue;

    const row1 = aoa[0] as unknown[];
    const multiGroups = detectMultiCampaignGroups(row1);
    if (!multiGroups) {
      // Single-campaign sheet — nothing to do here for "import all".
      continue;
    }

    // Separate info groups from campaign groups.
    for (const group of multiGroups) {
      if (investorInfoAliases.includes(normHeader(group.groupName))) {
        result.skipped_info_groups.push(group.groupName);
        continue;
      }

      // Find a matching campaign in the DB.
      const matched = campaigns.find((c) => {
        const normC = normHeader(c.name);
        const normG = normHeader(group.groupName);
        if (normC === normG) return true;
        if (normC.includes(normG) || normG.includes(normC)) return true;
        // Token subset.
        const cTokens = normC.split(" ").filter((t) => t.length >= 2);
        const gTokens = new Set(normG.split(" ").filter((t) => t.length >= 2));
        return cTokens.length > 0 && cTokens.every((t) => gTokens.has(t));
      });

      if (!matched) {
        result.campaigns.push({
          group_name: group.groupName,
          campaign_id: null,
          campaign_name: null,
          parsed: null,
          skip_reason: `No campaign in the database matches "${group.groupName}". Create the campaign first, then re-import.`,
        });
        continue;
      }

      // Run the existing single-campaign parse for this campaign ID.
      try {
        const parsed = await parseTrackerXlsx(buffer, filename, matched.id);
        result.campaigns.push({
          group_name: group.groupName,
          campaign_id: matched.id,
          campaign_name: matched.name,
          parsed,
          skip_reason: null,
        });
      } catch (err) {
        result.campaigns.push({
          group_name: group.groupName,
          campaign_id: matched.id,
          campaign_name: matched.name,
          parsed: null,
          skip_reason: `Parse failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // Stop after the first sheet that had groups — subsequent sheets would
    // duplicate the result.
    break;
  }

  return result;
}

// ── Apply ─────────────────────────────────────────────────────────────

export interface ApplyResult {
  inserted: number;
  updated: number;
  /** Rows that were identical to what's already in the database — no
   *  write was needed. Surfaced so the user can see the spreadsheet was
   *  genuinely a duplicate rather than silently swallowed. */
  duplicates: number;
  skipped: number;
  errors: Array<{ firm: string; reason: string }>;
}

export async function applyTrackerIngest(
  parsed: ParsedTracker,
  applyRowNumbers: Array<{ sheet_name: string; row_number: number }>,
): Promise<ApplyResult> {
  const supabase = await createServerClient();
  const wanted = new Set(
    applyRowNumbers.map((r) => `${r.sheet_name}:${r.row_number}`),
  );

  let inserted = 0;
  let updated = 0;
  let duplicates = 0;
  let skipped = 0;
  const errors: ApplyResult["errors"] = [];

  // Fetch auth user once — reused for email override writes.
  const { data: { user: authUser } } = await supabase.auth.getUser();

  for (const row of parsed.rows) {
    if (!wanted.has(`${row.sheet_name}:${row.row_number}`)) {
      skipped++;
      continue;
    }
    if (!row.matched_investor_id) {
      skipped++;
      continue;
    }

    try {
      if (row.planned_action === "update" && row.existing_campaign_partner_id) {
        // ── Merge logic ────────────────────────────────────────────────
        // Status: only advance, never downgrade.
        // Commentary: append with date stamp, never overwrite.
        // last_contact_at: take the more recent of the two.

        const patch: Record<string, unknown> = {};

        // Status — only update if the incoming rank is equal or higher.
        if (
          row.status_code &&
          statusCodeRank(row.status_code) >= statusCodeRank(row.existing_status_code)
        ) {
          patch.status_code = row.status_code;
          patch.status_label = row.status_label;
        }

        // Commentary — merge-append; never clobber existing notes.
        const mergedCommentary = mergeCommentary(row.existing_commentary, row.commentary);
        if (mergedCommentary !== row.existing_commentary) {
          patch.approver_note = mergedCommentary;
        }

        // last_contact_at — take the more recent of the two dates.
        if (row.last_contact_at) {
          const incoming = new Date(row.last_contact_at).getTime();
          const existing = row.existing_last_contact_at
            ? new Date(row.existing_last_contact_at).getTime()
            : null;
          if (existing === null || incoming > existing) {
            patch.last_contact_at = row.last_contact_at;
          }
        }

        // If nothing meaningful changed (and no email to write), this is
        // a true duplicate — record it as such without touching the DB.
        if (Object.keys(patch).length === 0 && !row.email) {
          duplicates++;
          continue;
        }

        if (Object.keys(patch).length > 0) {
          const { error } = await supabase
            .from("campaign_partners")
            .update(patch)
            .eq("id", row.existing_campaign_partner_id);
          if (error) throw error;
        }

        // Write email override if the sheet has one that differs.
        if (row.email) {
          const { data: cpRow } = await supabase
            .from("campaign_partners")
            .select("partner_id, partners_mirror:partner_id(email)")
            .eq("id", row.existing_campaign_partner_id)
            .maybeSingle();
          const cp = cpRow as unknown as { partner_id: number; partners_mirror: { email: string | null } | null } | null;
          if (cp && authUser) {
            const existingEmail = cp.partners_mirror?.email;
            if (!existingEmail || existingEmail.toLowerCase() !== row.email.toLowerCase()) {
              await supabase.from("partner_email_overrides").upsert({
                partner_id: cp.partner_id,
                email: row.email,
                email_tier: "unverified",
                source_note: `Imported from ${parsed.filename}`,
                created_by: authUser.id,
              }, { onConflict: "partner_id" });
            }
          }
        }

        updated++;

      } else if (row.planned_action === "insert") {
        // ── Find or select a partner ───────────────────────────────────
        const { data: partners } = await supabase
          .from("partners_mirror")
          .select("id, name, is_primary_contact, email")
          .eq("investor_id", row.matched_investor_id);
        const pList = (partners ?? []) as Array<{
          id: number;
          name: string | null;
          is_primary_contact: boolean | null;
          email: string | null;
        }>;
        if (pList.length === 0) {
          errors.push({
            firm: row.firm_name ?? "(unknown)",
            reason: "No partners on file for that investor — manual lookup needed.",
          });
          skipped++;
          continue;
        }

        let partnerId: number;
        if (row.contact_name && pList.length > 1) {
          const normContact = normFirm(row.contact_name);
          const nameMatch = pList.find((p) =>
            p.name && (normFirm(p.name) === normContact ||
              normFirm(p.name).includes(normContact) ||
              normContact.includes(normFirm(p.name))),
          );
          partnerId = nameMatch?.id
            ?? pList.find((p) => p.is_primary_contact)?.id
            ?? pList[0].id;
        } else {
          partnerId = pList.find((p) => p.is_primary_contact)?.id ?? pList[0].id;
        }

        const upsertPayload: Record<string, unknown> = {
          campaign_id: parsed.campaign_id,
          partner_id: partnerId,
          status_code: row.status_code ?? "+0",
          status_label: row.status_label ?? labelFor("+0"),
        };
        if (row.commentary) upsertPayload.approver_note = mergeCommentary(null, row.commentary);
        if (row.last_contact_at) upsertPayload.last_contact_at = row.last_contact_at;

        // Use upsert so that importing the same spreadsheet twice is safe.
        // On conflict the existing row wins — we do NOT blindly overwrite a
        // row that the parse phase already classified as "insert" (which can
        // only happen if the DB state changed between parse and apply, e.g.
        // two imports in rapid succession). Ignore is the conservative choice.
        const { error } = await supabase
          .from("campaign_partners")
          .upsert(upsertPayload, {
            onConflict: "campaign_id,partner_id",
            ignoreDuplicates: true,
          });
        if (error) throw error;
        inserted++;

        // Write email override if the sheet has one that differs.
        if (row.email && authUser) {
          const matchedPartner = pList.find((p) => p.id === partnerId);
          const existingEmail = matchedPartner?.email;
          if (!existingEmail || existingEmail.toLowerCase() !== row.email.toLowerCase()) {
            await supabase.from("partner_email_overrides").upsert({
              partner_id: partnerId,
              email: row.email,
              email_tier: "unverified",
              source_note: `Imported from ${parsed.filename}`,
              created_by: authUser.id,
            }, { onConflict: "partner_id" });
          }
        }

      } else {
        skipped++;
      }
    } catch (err) {
      errors.push({
        firm: row.firm_name ?? "(unknown)",
        reason: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return { inserted, updated, duplicates, skipped, errors };
}

function mergeCommentary(
  existing: string | null,
  incoming: string | null,
): string | null {
  if (!incoming) return existing;
  const today = new Date().toISOString().slice(0, 10);
  const stamped = `[${today}] ${incoming}`;
  if (!existing) return stamped;
  // Avoid duplicating the same incoming line.
  if (existing.includes(incoming)) return existing;
  return `${existing} | ${stamped}`;
}
