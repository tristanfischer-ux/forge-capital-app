import { STATUS_BY_CODE, labelFor } from "@/lib/status-codes";

export const RAISE_COLUMNS: {
  key: string;
  campaignName: string;
  statusCol: number; // 1-based
  commentaryCol: number;
  firstSentCol: number;
  latestCol: number;
  tickCol: number;
}[] = [
  { key: "SkySails", campaignName: "SkySails Power", tickCol: 2, firstSentCol: 16, latestCol: 17, statusCol: 19, commentaryCol: 20 },
  { key: "FishFrom", campaignName: "FishFrom Technologies", tickCol: 3, firstSentCol: 21, latestCol: 22, statusCol: 24, commentaryCol: 25 },
  { key: "Panatere", campaignName: "Panatere", tickCol: 4, firstSentCol: 26, latestCol: 27, statusCol: 29, commentaryCol: 30 },
  { key: "Space Solar", campaignName: "Space Solar", tickCol: 5, firstSentCol: 31, latestCol: 32, statusCol: 34, commentaryCol: 35 },
  { key: "Casper", campaignName: "Casper Funding", tickCol: 6, firstSentCol: 36, latestCol: 37, statusCol: 39, commentaryCol: 40 },
  { key: "US Arb", campaignName: "US Arbitrage", tickCol: 7, firstSentCol: 41, latestCol: 42, statusCol: 44, commentaryCol: 45 },
  { key: "Odysseus", campaignName: "Odysseus Space", tickCol: 8, firstSentCol: 46, latestCol: 47, statusCol: 49, commentaryCol: 50 },
  { key: "Hooley", campaignName: "Hooley RF", tickCol: 9, firstSentCol: 51, latestCol: 52, statusCol: 54, commentaryCol: 55 },
];

export interface MappedStatus {
  statusCode: string | null;
  permission: "not_required" | "pending_approval" | "approved" | "denied";
  needsReview: boolean;
}

const CODE_RE = /^([+\-]\d+(?:\.\d+)?)/;

export function mapSpreadsheetStatus(raw: string | null): MappedStatus {
  if (!raw || !raw.trim()) {
    return { statusCode: null, permission: "not_required", needsReview: false };
  }
  const text = raw.trim();
  const lower = text.toLowerCase();

  if (/permission requested/i.test(text) || /us candidate/i.test(text)) {
    const m = text.match(CODE_RE);
    const code = m && STATUS_BY_CODE[m[1]] ? m[1] : "+0";
    return { statusCode: code, permission: "pending_approval", needsReview: false };
  }
  if (/draft held/i.test(text) || /awaiting company approval/i.test(text)) {
    return { statusCode: "+1", permission: "pending_approval", needsReview: false };
  }
  if (/^rejected/i.test(text)) {
    return { statusCode: "-1", permission: "not_required", needsReview: false };
  }
  if (/ongoing discussions/i.test(text)) {
    return { statusCode: null, permission: "not_required", needsReview: true };
  }
  if (/^no answer/i.test(text) || /no meeting yet/i.test(text)) {
    return { statusCode: null, permission: "not_required", needsReview: true };
  }

  const m = text.match(CODE_RE);
  if (m && STATUS_BY_CODE[m[1]]) {
    const code = m[1];
    return {
      statusCode: code,
      permission: "not_required",
      needsReview: false,
    };
  }
  return { statusCode: null, permission: "not_required", needsReview: true };
}

export function excelDateToIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "number") {
    // Excel serial
    const utc = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!Number.isNaN(utc.getTime())) return utc.toISOString();
  }
  const s = String(value);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return null;
}

export { labelFor };
