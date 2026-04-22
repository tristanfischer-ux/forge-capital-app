/**
 * Types for the verification-gate server actions. Kept in a sibling file
 * because `actions.ts` carries `"use server"` and only async functions
 * may be exported from `"use server"` modules (per the ForgeOS gotcha:
 * `forgeos_use_server_non_async_exports.md`). Same convention used in
 * this repo by `match-score-types.ts`.
 */

export type BulkActionResult =
  | { ok: true; processed: number; skipped: number }
  | { ok: false; error: string };

export type MarkInactiveResult =
  | { ok: true; processed: number }
  | { ok: false; error: string };
