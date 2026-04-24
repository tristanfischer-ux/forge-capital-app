"use server";

import { createServerClient } from "@/lib/supabase/server";

/**
 * Hunter email-finder server action for /send Step 5.
 *
 * Why: the 93 Fischer Farms customer rows have no contact emails on
 * file. Manual entry in Step 5 is one path; this action is the other
 * — given a firm + website, call Hunter.io's email-finder and return
 * candidate addresses so Tristan can pick one.
 *
 * We use /v2/domain-search (returns every email Hunter knows for the
 * domain) rather than /v2/email-finder (needs first + last name) —
 * customer rows rarely have a named contact yet. domain-search
 * returns the directory; Tristan picks the best candidate by role
 * + verification score.
 *
 * Hunter API docs: https://hunter.io/api-documentation/v2#domain-search
 */

export interface HunterCandidate {
  email: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  department: string | null;
  linkedin: string | null;
  confidence: number | null; // 0-100 Hunter score
  sources_count: number | null;
  type: "personal" | "generic" | null;
  verification_status: string | null;
}

export type HunterHuntResult =
  | {
      ok: true;
      domain: string;
      candidates: HunterCandidate[];
      organisation: string | null;
      total: number;
    }
  | { ok: false; error: string };

function normaliseDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const withScheme = raw.startsWith("http") ? raw : `https://${raw}`;
    const u = new URL(withScheme);
    return u.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    // Maybe it was already a bare hostname like "ikea.com"
    const bare = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
    return bare.match(/\./) ? bare : null;
  }
}

/**
 * Find Hunter candidates for a customer partner.
 *
 * Resolves the domain from customers_mirror.website when the customer
 * partner's kind is 'customer'. Returns a ranked candidate list. Does
 * not save anything — the caller picks one and saves via
 * setPartnerEmail (see `./actions.ts`).
 */
export async function huntCandidatesForCampaignPartner(
  campaignPartnerId: string,
): Promise<HunterHuntResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const hunterKey = process.env.HUNTER_API_KEY?.trim();
  if (!hunterKey) {
    return {
      ok: false,
      error:
        "HUNTER_API_KEY is not set in this environment. Add it via `vercel env add HUNTER_API_KEY` to unlock Hunter lookups.",
    };
  }

  // Resolve the firm + domain for this campaign_partner row.
  const { data: cpRow, error: cpErr } = await supabase
    .from("campaign_partners")
    .select(
      `
      id,
      partners_mirror:partner_id (
        id, kind, investor_id, customer_id,
        investors_mirror:investor_id ( firm_name, website ),
        customers_mirror:customer_id ( firm_name, website )
      )
      `,
    )
    .eq("id", campaignPartnerId)
    .maybeSingle();
  if (cpErr || !cpRow) {
    return {
      ok: false,
      error: cpErr?.message ?? "campaign_partner row not found.",
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = cpRow as any;
  const partner = row.partners_mirror;
  if (!partner) return { ok: false, error: "No partner linked to this row." };

  const firm =
    partner.kind === "investor"
      ? partner.investors_mirror
      : partner.customers_mirror;
  if (!firm) return { ok: false, error: "No firm linked to this partner." };

  const domain = normaliseDomain(firm.website);
  if (!domain) {
    return {
      ok: false,
      error: `No website on file for "${firm.firm_name ?? "this firm"}" — add a website on the customer row first so Hunter has a domain to search.`,
    };
  }

  // Hit Hunter's domain-search endpoint.
  const params = new URLSearchParams({
    domain,
    api_key: hunterKey,
    limit: "25",
    // Ask Hunter to filter to personal addresses first — generic ones
    // (info@, sales@) show up at the bottom for fallback.
    type: "personal",
  });
  const url = `https://api.hunter.io/v2/domain-search?${params.toString()}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      // Hunter typically responds in ~1-2s; 15s is generous.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Hunter request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      error: `Hunter returned HTTP ${response.status}: ${text.slice(0, 200)}`,
    };
  }
  interface HunterEmailRow {
    value?: unknown;
    first_name?: unknown;
    last_name?: unknown;
    position?: unknown;
    department?: unknown;
    linkedin?: unknown;
    confidence?: unknown;
    sources?: unknown;
    type?: unknown;
    verification?: { status?: unknown };
  }
  interface HunterPayload {
    data?: {
      domain?: unknown;
      organization?: unknown;
      emails?: HunterEmailRow[];
    };
  }
  let payload: HunterPayload;
  try {
    payload = (await response.json()) as HunterPayload;
  } catch {
    return { ok: false, error: "Hunter response was not valid JSON." };
  }
  const data = payload?.data ?? {};
  const emails: HunterEmailRow[] = Array.isArray(data.emails) ? data.emails : [];

  const candidates: HunterCandidate[] = emails
    .filter((e) => typeof e.value === "string")
    .map((e) => ({
      email: String(e.value).trim().toLowerCase(),
      first_name: typeof e.first_name === "string" ? e.first_name : null,
      last_name: typeof e.last_name === "string" ? e.last_name : null,
      position: typeof e.position === "string" ? e.position : null,
      department: typeof e.department === "string" ? e.department : null,
      linkedin: typeof e.linkedin === "string" ? e.linkedin : null,
      confidence:
        typeof e.confidence === "number"
          ? e.confidence
          : typeof e.confidence === "string"
            ? Number.parseInt(e.confidence, 10)
            : null,
      sources_count: Array.isArray(e.sources) ? e.sources.length : null,
      type: ((): "personal" | "generic" | null => {
        if (e.type === "personal") return "personal";
        if (e.type === "generic") return "generic";
        return null;
      })(),
      verification_status:
        typeof e.verification?.status === "string"
          ? e.verification.status
          : null,
    }))
    .sort((a, b) => {
      // Ranking: personal > generic; confidence desc; position-filled
      // first; alphabetical as tiebreak.
      if (a.type !== b.type) {
        if (a.type === "personal") return -1;
        if (b.type === "personal") return 1;
      }
      const ac = a.confidence ?? -1;
      const bc = b.confidence ?? -1;
      if (ac !== bc) return bc - ac;
      if (!!a.position !== !!b.position) return a.position ? -1 : 1;
      return a.email.localeCompare(b.email);
    });

  return {
    ok: true,
    domain,
    organisation: typeof data.organization === "string" ? data.organization : null,
    total: candidates.length,
    candidates,
  };
}
