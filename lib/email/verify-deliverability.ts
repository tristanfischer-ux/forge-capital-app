import { checkMx } from "./check-mx";

/**
 * Pre-flight deliverability probe — Rule 13 compliance.
 *
 * Order of preference:
 *   1. Hunter.io /v2/email-verifier when HUNTER_API_KEY is set. This
 *      is the Kite Power CLAUDE.md Rule 13 path — a real SMTP probe
 *      per recipient, returns deliverable/undeliverable/risky/unknown.
 *      Codified 2026-04-23 after v6 batch bounced 29%.
 *   2. Fall back to MX-only (lib/email/check-mx.ts) if no Hunter key.
 *      Necessary but not sufficient — the app still sends rather than
 *      blocks the founder's work when the verifier can't be reached.
 *
 * Results cache per-email for 24h to avoid wasting Hunter credits on
 * the same address across back-to-back batches. Batches of 20 to 20
 * distinct addresses cost 20 Hunter credits (~$0.40 at standard
 * pricing); re-sending to the same address within 24h costs nothing.
 */

export interface VerifyResult {
  email: string;
  deliverable: boolean;
  /** raw provider status where available — "deliverable" | "risky" |
   *  "undeliverable" | "unknown" | "mx_ok" | "mx_fail" | "no_key" */
  status: string;
  reason: string;
  provider: "hunter" | "mx";
  /** Score 0-100 from Hunter; null when falling back to MX. */
  score: number | null;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
type CacheEntry = { result: VerifyResult; at: number };
const cache = new Map<string, CacheEntry>();

export function clearVerifyCache() {
  cache.clear();
}

export async function verifyDeliverability(email: string): Promise<VerifyResult> {
  const normalised = (email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {
    return {
      email: normalised,
      deliverable: false,
      status: "invalid_format",
      reason: "Email address failed syntax check.",
      provider: "mx",
      score: null,
    };
  }
  const cached = cache.get(normalised);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.result;
  }

  const hunterKey = process.env.HUNTER_API_KEY?.trim();
  if (hunterKey) {
    try {
      const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(normalised)}&api_key=${encodeURIComponent(hunterKey)}`;
      const res = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        interface HunterResponse {
          data?: {
            status?: string;
            result?: string;
            score?: number;
            regexp?: boolean;
            gibberish?: boolean;
            disposable?: boolean;
            webmail?: boolean;
            mx_records?: boolean;
            smtp_server?: boolean;
            smtp_check?: boolean;
            accept_all?: boolean;
            block?: boolean;
          };
          errors?: Array<{ id?: string; code?: number; details?: string }>;
        }
        const body = (await res.json()) as HunterResponse;
        const status =
          body.data?.status ?? body.data?.result ?? "unknown";
        const score = typeof body.data?.score === "number" ? body.data.score : null;

        // Rule 13: only "deliverable" with a valid SMTP check passes.
        // "risky" / "accept_all" / "unknown" are excluded — these were
        // the pattern-synthesised addresses that bounced in v6.
        const deliverable = status === "deliverable" || status === "valid";
        const reason = deliverable
          ? `Hunter SMTP probe: ${status}${score !== null ? ` (score ${score})` : ""}`
          : `Hunter SMTP probe: ${status}${score !== null ? ` (score ${score})` : ""}. Rule 13 excludes this.`;
        const result: VerifyResult = {
          email: normalised,
          deliverable,
          status,
          reason,
          provider: "hunter",
          score,
        };
        cache.set(normalised, { result, at: Date.now() });
        return result;
      }
      // Hunter returned non-2xx — fall through to MX backup so we
      // don't block real sends when the verifier is flaky.
      console.warn(
        `Hunter verifier returned ${res.status} for ${normalised} — falling back to MX check.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Hunter verifier threw for ${normalised}: ${msg} — falling back to MX.`);
    }
  }

  // MX fallback — either no key set, or Hunter unreachable.
  const mx = await checkMx(normalised);
  const result: VerifyResult = {
    email: normalised,
    deliverable: mx.deliverable,
    status: mx.deliverable ? "mx_ok" : "mx_fail",
    reason: hunterKey
      ? `Hunter unreachable; MX fallback: ${mx.reason}`
      : `HUNTER_API_KEY not set; MX-only check: ${mx.reason}`,
    provider: "mx",
    score: null,
  };
  cache.set(normalised, { result, at: Date.now() });
  return result;
}
