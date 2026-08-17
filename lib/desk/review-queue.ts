import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeFirmName, saveAlias } from "@/lib/desk/identity";

export interface ReviewRow {
  id: string;
  campaign_name: string;
  firm_name: string | null;
  contact_name: string | null;
  email: string | null;
  status_raw: string | null;
  reason: string;
  commentary?: string;
  disposition?: string;
}

const FILE = join(process.cwd(), "data/import-review-queue.json");

export function loadReviewFile(): ReviewRow[] {
  if (!existsSync(FILE)) return [];
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as ReviewRow[];
  } catch {
    return [];
  }
}

function saveReviewFile(rows: ReviewRow[]) {
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(rows, null, 2));
}

export function ensureRowIds(rows: ReviewRow[]): ReviewRow[] {
  let changed = false;
  const out = rows.map((r, i) => {
    if (r.id) return r;
    changed = true;
    return { ...r, id: `local-${i}-${(r.firm_name ?? "x").slice(0, 12)}` };
  });
  if (changed) saveReviewFile(out);
  return out;
}

export function disposeReviewRow(
  id: string,
  disposition: "matched" | "excluded" | "local_stub" | "waived",
  extra?: { cleanFirm?: string },
): ReviewRow | null {
  const rows = ensureRowIds(loadReviewFile());
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const row = rows[idx];
  if (extra?.cleanFirm && row.firm_name) {
    saveAlias({ dirty: row.firm_name, clean: extra.cleanFirm });
  }
  rows[idx] = { ...row, disposition, firm_name: extra?.cleanFirm ?? row.firm_name };
  saveReviewFile(rows);
  return rows[idx];
}

export function clusterKey(row: ReviewRow): string {
  return normalizeFirmName(row.firm_name).toLowerCase() || (row.email ?? "none");
}
