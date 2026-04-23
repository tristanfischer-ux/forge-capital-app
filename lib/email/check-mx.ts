import { promises as dns } from "node:dns";

/**
 * Live MX-record check — runs a DNS lookup on the recipient's domain
 * before Gmail send dispatches. Prevents hard-bounces from typo
 * domains, dead-address firms, and stale contact cards from ever
 * hitting Gmail's rate limit.
 *
 * Per Tristan's 2026-04-23 ask: "before it sends an email, it does a
 * check of the valid MX records. We just want to make sure that you
 * are following that, that every email that goes out, we're actually
 * checking that it's not going to bounce before it sends."
 *
 * Strategy:
 *   1. resolveMx(domain). If any MX record returns, deliverable.
 *   2. If no MX, try resolve4(domain). Historical fallback — some
 *      small domains still accept mail on implicit-A records.
 *   3. If both fail, reject.
 *
 * Results are cached per-domain for `CACHE_TTL_MS` so batches of 20
 * to the same domain cost one DNS call, not 20.
 */

interface CheckMxResult {
  domain: string;
  deliverable: boolean;
  reason: string;
  mxHosts?: string[];
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
type CacheEntry = { result: CheckMxResult; at: number };
const cache = new Map<string, CacheEntry>();

export function clearMxCache() {
  cache.clear();
}

export async function checkMx(email: string): Promise<CheckMxResult> {
  const trimmed = (email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return {
      domain: "",
      deliverable: false,
      reason: "Invalid email address format.",
    };
  }
  const domain = trimmed.split("@")[1];
  const cached = cache.get(domain);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.result;
  }

  let result: CheckMxResult;
  try {
    const mxRecords = await dns.resolveMx(domain);
    if (mxRecords && mxRecords.length > 0) {
      const hosts = mxRecords
        .sort((a, b) => a.priority - b.priority)
        .map((r) => r.exchange)
        .filter(Boolean);
      result = {
        domain,
        deliverable: true,
        reason: `MX records resolved (${hosts.length}).`,
        mxHosts: hosts,
      };
    } else {
      result = {
        domain,
        deliverable: false,
        reason: "Domain has no MX records.",
      };
    }
  } catch (err) {
    // resolveMx throws ENOTFOUND / ENODATA when the domain has no MX
    // records at all. Try resolve4 as a belt-and-braces fallback for
    // old-school domains that accept mail on implicit-A records.
    try {
      const ips = await dns.resolve4(domain);
      if (ips && ips.length > 0) {
        result = {
          domain,
          deliverable: true,
          reason: "No MX, but A record present (implicit-A fallback).",
        };
      } else {
        result = {
          domain,
          deliverable: false,
          reason: "No MX and no A records.",
        };
      }
    } catch (err2) {
      const msg =
        err2 instanceof Error ? err2.message : String(err2);
      const firstErr = err instanceof Error ? err.message : String(err);
      result = {
        domain,
        deliverable: false,
        reason: `DNS lookup failed — MX: ${firstErr}; A: ${msg}`,
      };
    }
  }

  cache.set(domain, { result, at: Date.now() });
  return result;
}
