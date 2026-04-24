"use server";

import Anthropic from "@anthropic-ai/sdk";
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
  /** Role-fit rank (1 = most likely right person for THIS specific
   *  pitch). Null before the ranker has run. */
  rank: number | null;
  /** One-sentence reasoning for why this candidate fits (or doesn't)
   *  this specific pitch. Null before the ranker has run. */
  reason: string | null;
  /** Which model produced the rank — "deepseek-v4-flash" (primary via
   *  OpenRouter) or "haiku-4-5" (fallback via Anthropic). Null before
   *  the ranker has run. Displayed in the UI so Tristan knows when
   *  we've fallen back. */
  ranker_model: "deepseek-v4-flash" | "haiku-4-5" | null;
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
      rank: null,
      reason: null,
      ranker_model: null,
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

/* ─────────────────────── Role-fit ranker (DeepSeek + Haiku) ──────────────── */

export type RankCandidatesResult =
  | {
      ok: true;
      ranked: HunterCandidate[];
      /** Which model produced the rank. Surfaced to the UI banner so
       *  Tristan can tell when we've fallen back to Haiku. */
      model: "deepseek-v4-flash" | "haiku-4-5";
    }
  | { ok: false; error: string };

/**
 * Thin LLM layer between Hunter and the picker.
 *
 * Tristan 2026-04-24: "This Hunter thing is basically who has an
 * email — not very helpful. What we really want to figure out is
 * who's the right person to be speaking to."
 *
 * Given the campaign's product brief + hunting criteria + the
 * customer's pitch hook + the Hunter candidate list, asks a small
 * model to rank the candidates by role-pitch fit and return
 * one-sentence reasoning per candidate. The picker then displays
 * them in rank order with the reasoning below each.
 *
 * Two-tier model routing (2026-04-24):
 *   PRIMARY — `deepseek/deepseek-v4-flash` via OpenRouter. ~£0.0002
 *     per 23-candidate call (~1K in + ~500 out tokens). ~15× cheaper
 *     than Haiku, ~300× cheaper than Opus 4.7. Structured-JSON tasks
 *     with explicit rules don't need heavier reasoning.
 *   FALLBACK — `claude-haiku-4-5` via Anthropic. Used when OpenRouter
 *     errors, times out, or returns malformed JSON. ~£0.005 per call.
 *
 * Robustness: if BOTH models fail the candidate list is returned
 * unchanged with rank/reason left null, and the picker falls back to
 * Hunter's native ordering.
 */
export async function rankCandidatesForCampaignPartner(
  campaignPartnerId: string,
  candidates: HunterCandidate[],
): Promise<RankCandidatesResult> {
  if (!campaignPartnerId) {
    return { ok: false, error: "campaignPartnerId is required." };
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { ok: true, ranked: candidates, model: "deepseek-v4-flash" };
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!openRouterKey && !anthropicKey) {
    return {
      ok: false,
      error:
        "Neither OPENROUTER_API_KEY nor ANTHROPIC_API_KEY is set — cannot rank candidates. Falling back to Hunter's native order.",
    };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Load the context the ranker needs: product brief + hunting
  // criteria from the campaign; firm_name + pitch_hook + type +
  // channel + bio from the customer mirror.
  const { data: cp, error: cpErr } = await supabase
    .from("campaign_partners")
    .select(
      `
      id,
      campaigns:campaign_id ( company_description, hunting_criteria ),
      partners_mirror:partner_id (
        kind,
        investors_mirror:investor_id ( firm_name, thesis_summary, type ),
        customers_mirror:customer_id (
          firm_name, pitch_hook, bio, type, channel, country_iso
        )
      )
      `,
    )
    .eq("id", campaignPartnerId)
    .maybeSingle();
  if (cpErr || !cp) {
    return {
      ok: false,
      error: cpErr?.message ?? "campaign_partner row not found.",
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = cp as any;
  const campaign = row.campaigns ?? null;
  const partner = row.partners_mirror ?? null;
  const customer = partner?.customers_mirror ?? null;
  const investor = partner?.investors_mirror ?? null;

  const firmName =
    (partner?.kind === "investor" ? investor?.firm_name : customer?.firm_name) ??
    "this firm";
  const pitchHook =
    (partner?.kind === "investor"
      ? investor?.thesis_summary
      : customer?.pitch_hook) ?? "";
  const firmType =
    (partner?.kind === "investor" ? investor?.type : customer?.type) ?? "";
  const channel = customer?.channel ?? "";
  const country = customer?.country_iso ?? "";
  const bio = customer?.bio ?? "";
  const brief = campaign?.company_description ?? "";
  const criteria = campaign?.hunting_criteria ?? "";

  // Serialise candidates compactly — email + position + department +
  // type (personal vs generic). Name is optional. Keep under 3K
  // tokens so prompt fits comfortably.
  const candidateLines = candidates
    .map(
      (c, i) =>
        `${i + 1}. ${c.email} | position: ${c.position ?? "—"} | dept: ${c.department ?? "—"} | type: ${c.type ?? "—"}${c.first_name ? ` | name: ${[c.first_name, c.last_name].filter(Boolean).join(" ")}` : ""}`,
    )
    .join("\n");

  const systemPrompt = `You rank outreach candidates at a target firm by role-pitch fit.

You'll receive:
- Our product (what we sell)
- Our hunting criteria (who we're looking for)
- A specific firm + why we think they're a fit
- A list of Hunter candidates at that firm (email + position + department + type)

Return ONE JSON object: { "ranked": [ { "email": "...", "rank": 1, "reason": "one-sentence why they are or aren't the right person for this SPECIFIC pitch" } ] }

Rules:
- Rank every candidate you receive. Rank 1 = most likely the right person. Use dense integer ranks (1, 2, 3, …).
- Focus on ROLE-PITCH FIT. For a cost/margin pitch, commercial and category-buyer roles rank high. For regulatory (e.g. EU 2026 residue ban) pitches, sustainability / compliance / product-safety / CSR roles rank high. For capacity / operations pitches, production / operations / greenhouse managers rank high. For DTC / brand pitches, marketing / brand / CX rank moderate, sourcing / buying rank high.
- Generic addresses (info@, sales@, marketing@) rank last unless the firm is tiny and the alternative is nothing.
- "reason" must be SPECIFIC to the pitch — don't write "VP of Buying" as a reason; write "owns plant-category budget, directly impacted by the EU 2026 ban hook".
- Output JSON only. No preamble, no markdown fences.`;

  const userPrompt = `PRODUCT:
${brief || "—"}

HUNTING CRITERIA:
${criteria || "—"}

FIRM: ${firmName} (${firmType}${channel ? `, ${channel}` : ""}${country ? `, ${country}` : ""})
WHY THIS FIRM: ${pitchHook || "—"}
${bio ? `FIRM BIO: ${bio}` : ""}

HUNTER CANDIDATES (${candidates.length}):
${candidateLines}

Return the JSON object now.`;

  // Try DeepSeek v4 Flash first (primary), fall back to Haiku 4.5.
  // Each attempt returns either parsed JSON or a failure reason; we
  // try Haiku only if DeepSeek fails (network error, HTTP non-200, or
  // unparseable response).
  type RankerAttempt =
    | { ok: true; raw: string; model: "deepseek-v4-flash" | "haiku-4-5" }
    | { ok: false; error: string };

  async function tryDeepSeek(): Promise<RankerAttempt> {
    if (!openRouterKey) {
      return { ok: false, error: "OPENROUTER_API_KEY missing" };
    }
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek/deepseek-v4-flash",
          // JSON-mode keeps Flash from wrapping output in prose.
          response_format: { type: "json_object" },
          // DeepSeek v4 Flash is a reasoning model — it emits thinking
          // tokens into the `reasoning` field BEFORE producing the
          // actual `content`. At max_tokens: 4000 a 23-candidate rank
          // blew the budget on reasoning and returned content=null,
          // silently falling through to Haiku. 16K gives enough
          // headroom for any realistic candidate list. Per
          // `v4_flash_production_gotchas.md` memory.
          max_tokens: 16_000,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
        // Longer timeout too — reasoning tokens add latency.
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          ok: false,
          error: `DeepSeek HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
      }
      const payload = (await res.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        return { ok: false, error: "DeepSeek returned empty content." };
      }
      return { ok: true, raw: content.trim(), model: "deepseek-v4-flash" };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? `DeepSeek fetch failed: ${err.message}` : "DeepSeek fetch failed.",
      };
    }
  }

  async function tryHaiku(): Promise<RankerAttempt> {
    if (!anthropicKey) {
      return { ok: false, error: "ANTHROPIC_API_KEY missing (no fallback available)" };
    }
    try {
      const client = new Anthropic({ apiKey: anthropicKey });
      const msg = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
      const raw = msg.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("")
        .trim();
      if (!raw) return { ok: false, error: "Haiku returned empty content." };
      return { ok: true, raw, model: "haiku-4-5" };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? `Haiku call failed: ${err.message}` : "Haiku call failed.",
      };
    }
  }

  function parseRankerJson(raw: string):
    | { ok: true; rankedRaw: Array<{ email?: unknown; rank?: unknown; reason?: unknown }> }
    | { ok: false; error: string } {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    try {
      const parsed = JSON.parse(cleaned) as {
        ranked?: Array<{ email?: unknown; rank?: unknown; reason?: unknown }>;
      };
      return {
        ok: true,
        rankedRaw: Array.isArray(parsed?.ranked) ? parsed.ranked : [],
      };
    } catch {
      return {
        ok: false,
        error: `Ranker returned malformed JSON (first 200 chars): ${cleaned.slice(0, 200)}`,
      };
    }
  }

  // Attempt DeepSeek, parse; if anything fails, retry with Haiku.
  let attempt = await tryDeepSeek();
  let parsedResult = attempt.ok ? parseRankerJson(attempt.raw) : null;
  if (!attempt.ok || (parsedResult && !parsedResult.ok)) {
    const firstError = !attempt.ok ? attempt.error : (parsedResult as { ok: false; error: string }).error;
    console.warn("[ranker] DeepSeek failed, falling back to Haiku:", firstError);
    attempt = await tryHaiku();
    parsedResult = attempt.ok ? parseRankerJson(attempt.raw) : null;
    if (!attempt.ok) {
      return { ok: false, error: `Both models failed. Last error: ${attempt.error}` };
    }
    if (!parsedResult || !parsedResult.ok) {
      return {
        ok: false,
        error: (parsedResult as { ok: false; error: string } | null)?.error ?? "Haiku parse failed.",
      };
    }
  }
  const modelUsed = attempt.model;
  const rankedRaw = (parsedResult as { ok: true; rankedRaw: Array<{ email?: unknown; rank?: unknown; reason?: unknown }> }).rankedRaw;

  // Build rank + reason lookup by email.
  const rankByEmail = new Map<string, { rank: number; reason: string | null }>();
  for (const r of rankedRaw) {
    const email = typeof r.email === "string" ? r.email.trim().toLowerCase() : null;
    const rank = typeof r.rank === "number" ? r.rank : null;
    const reason = typeof r.reason === "string" ? r.reason.trim() : null;
    if (email && rank !== null) {
      rankByEmail.set(email, { rank, reason });
    }
  }

  // Enrich the original candidates. Any candidate the model missed
  // keeps rank=null and falls to the end of the list via a sentinel
  // rank (Number.MAX_SAFE_INTEGER).
  const ranked = candidates
    .map((c) => {
      const hit = rankByEmail.get(c.email);
      return {
        ...c,
        rank: hit?.rank ?? null,
        reason: hit?.reason ?? null,
        ranker_model: hit ? modelUsed : null,
      };
    })
    .sort((a, b) => {
      const ar = a.rank ?? Number.MAX_SAFE_INTEGER;
      const br = b.rank ?? Number.MAX_SAFE_INTEGER;
      return ar - br;
    });

  return { ok: true, ranked, model: modelUsed };
}
