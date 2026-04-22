/**
 * Types + constants for lookalike matching. Isolated from
 * `./lookalikes.ts` (which imports the server Supabase client) so
 * client components can depend on the shape without pulling the
 * server module into the browser bundle.
 *
 * Every addition / change here must stay in sync with `./lookalikes.ts`.
 */

export const MIN_LOOKALIKE_ANCHORS = 3;

/** Status codes that count as positive signal. Ordered by strength. */
export const POSITIVE_STATUS_WEIGHT: Record<string, number> = {
  "+6": 1, // Response received
  "+7": 2, // Meeting offered
  "+8": 3, // Meeting scheduled
  "+9": 4, // Meeting held
  "+10": 5, // NDA / diligence
  "+11": 6, // Term sheet
  "+12": 8, // Committed
};

export interface LookalikeAnchor {
  investor_id: number;
  firm_name: string;
  status_code: string;
  status_label: string | null;
  weight: number;
}

export interface LookalikeRow {
  investor_id: number;
  firm_name: string;
  hq_location: string | null;
  thesis_summary: string | null;
  sector_focus: string | null;
  stage_focus: string | null;
  geo_focus: string | null;
  /** 0-100, normalised against max anchor-weight sum. */
  match_score: number;
  /** Firm names of the anchors this lookalike most resembles. */
  matched_anchors: string[];
  /** 1-2 sentence human-readable reason. */
  reason: string;
}

export interface LookalikeResult {
  anchorCount: number;
  anchors: LookalikeAnchor[];
  /** Top lookalikes, empty if anchorCount < MIN_LOOKALIKE_ANCHORS. */
  rows: LookalikeRow[];
  /** Total pool scored (excludes already-contacted investors). */
  totalScored: number;
}
