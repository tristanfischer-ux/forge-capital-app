"use server";

import { callOpenRouter } from "@/lib/openrouter";
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { labelFor, STATUS_BY_CODE } from "@/lib/status-codes";

/**
 * Server actions backing the §9 Founder approval gate "Approval return
 * drop-zone" — the UI port of
 * `~/Developer/Forge-Capital/research/16-parse-approval-replies.py`.
 *
 * The flow:
 *  1. Tristan pastes an approver reply into the drop-zone.
 *  2. `parseApprovalReply` sends the text to Haiku with a strict JSON
 *     extraction prompt. Haiku returns one record per firm found in the
 *     reply — verdict (`ok` / `not_for_me` / `skip` / `maybe`) + optional
 *     note.
 *  3. Each Haiku record is fuzzy-matched against the investors already
 *     shortlisted on the active campaign (campaign_partners → partners_mirror
 *     → investors_mirror). Scope-to-campaign mirrors the Python script's
 *     V1.1 safeguard against a stray `investors_mirror` row hijacking a
 *     contains-match.
 *  4. The client renders a per-row review table. On "Apply selected",
 *     `applyApprovalVerdicts` writes the status_code / approver_note /
 *     approved_by transitions to `campaign_partners`.
 *
 * Verdict → status_code mapping (matches the Python script):
 *   ok           → '+1' Approved — awaiting draft (approved_by + approved_at set)
 *   not_for_me   → '-3' Disqualified (approver_note merged)
 *   skip         → '-3' Disqualified with [SKIP] prefix in the note
 *   maybe        → stays '+0'; approver_note gets a '[FLAG] …' marker
 *
 * Honest degradation: if ANTHROPIC_API_KEY is missing in env we return a
 * structured error (no fabricated parse). Callers render a tooltip
 * telling Tristan to add the key rather than silently running blind.
 */

export type Verdict = "ok" | "not_for_me" | "skip" | "maybe";

export interface ParsedLine {
  /** Firm name verbatim from the reply, as Haiku extracted it. */
  investor_name: string;
  verdict: Verdict;
  note: string;
  /** Raw line(s) from the reply that produced this record — for audit. */
  source: string;
  /** Haiku's self-reported confidence in the verdict, 0.0–1.0. Null when
   *  the response didn't include a numeric score (pre-2026-04-23 model
   *  replies or malformed JSON). UX audit 2026-04-23 item #12: surfaced
   *  on /approval Step 3 as a coloured badge so low-confidence parses
   *  get human review rather than silently landing in the tracker. */
  confidence: number | null;
}

export interface ApprovalMatch {
  /** campaign_partners.id — what `applyApprovalVerdicts` updates. */
  campaign_partner_id: string;
  /** investors_mirror.id — numeric investor row. */
  investor_id: number;
  /** Candidate firm_name as stored in investors_mirror. */
  firm_name: string | null;
  /** Current status_code on campaign_partners at parse time. */
  current_status_code: string | null;
  current_status_label: string | null;
  current_approver_note: string | null;
  /** What Haiku thinks. */
  proposed_verdict: Verdict;
  /** Free-text commentary Haiku pulled alongside the verdict. */
  proposed_note: string;
  /** Verbatim name from the reply Haiku parsed. */
  reply_name: string;
  /** Why we matched — debug-friendly. */
  match_reason: "exact" | "contains" | "token_subset";
  /** Haiku-reported verdict confidence 0.0–1.0 (null when the parser
   *  couldn't extract a score). UX audit 2026-04-23 item #12. */
  confidence: number | null;
}

export interface UnmatchedLine {
  reply_name: string;
  verdict: Verdict;
  note: string;
  /** 'none' (no candidate), 'ambiguous' (too many), or 'api_error'. */
  reason: "none" | "ambiguous";
  /** Haiku-reported verdict confidence 0.0–1.0 (may help Tristan
   *  decide whether to manually reconcile the unmatched row). */
  confidence: number | null;
}

export type ParseApprovalReplyResult =
  | {
      ok: true;
      matches: ApprovalMatch[];
      unmatched: UnmatchedLine[];
      /** How many distinct lines Haiku could classify. */
      parsed_count: number;
      /** Model stamp so we can audit which Haiku ran this. */
      model: string;
    }
  | { ok: false; error: string };

/* -------------------------------------------------------------------------- */
/* parseApprovalReply                                                         */
/* -------------------------------------------------------------------------- */

// Simple extraction task — use DeepSeek V4-Flash (cheap, fast).
const HAIKU_MODEL = "deepseek/deepseek-v4-flash";

const SYSTEM_PROMPT = `You are a strict email-reply parser for a venture-capital outreach tool.

The user pastes text that an approver wrote after reviewing a list of investor firms. Your job is to extract one structured record per firm mentioned, with the approver's verdict.

Return ONLY a single JSON object of the exact shape:
{"lines": [{"investor_name": string, "verdict": "ok" | "not_for_me" | "skip" | "maybe", "note": string, "source": string, "confidence": number}, ...]}

Rules:
- "investor_name" = the firm name exactly as written (trim surrounding whitespace; do NOT invent or canonicalise spelling).
- "verdict":
    "ok"         = any positive marker — ok, okay, yes, approve, approved, go, send, good, fine, sure, proceed, y
    "not_for_me" = explicit rejection — no, not for us, not for me, decline, declined, reject, rejected, drop, kill, pass, n
    "skip"       = explicit "skip this one" — skip, skipped, defer, out of scope, already-passed, already passed, already met, already knows
    "maybe"      = hesitation or needs-more-info — flag, flagged, hmm, maybe, unsure, tbd, hold, wait, check, not sure, let me think, ?, conflicting, conflict
  Priority order when multiple markers appear: "ok" > "not_for_me" > "skip" > "maybe". "flag" / "flagged" / "conflict" / "?" ALWAYS map to "maybe", never "skip".
  If you cannot map the text to one of those four, skip the line — do NOT emit a record.
- "note" = verbatim free-text the approver added on the same line AFTER the verdict marker (e.g. "not for me — we already met them last round" → note "we already met them last round"). If there is no extra commentary, return the empty string.
- "source" = the raw reply text line(s) you parsed this record from — preserve linebreaks if two adjacent lines form one record.
- "confidence" = your self-assessed certainty that the extracted verdict truly matches what the approver meant, as a decimal between 0.0 and 1.0. Use the following anchors:
    0.95–1.00 = unambiguous direct annotation ("Sequoia: ok", "Felicis — not for us")
    0.80–0.94 = clear intent but some inference (punctuation ambiguity, inline verb)
    0.60–0.79 = plausible but one reasonable alternative reading exists
    0.30–0.59 = you are guessing; the sentence structure supports multiple firms
    < 0.30    = almost certainly ambiguous — do not emit unless the verdict is strongly implied
  Always include confidence; never omit it.
- Skip signature blocks ("--", "Best,", "Sent from my iPhone"), Gmail quote markers (">"), and "On … wrote:" fences.
- Skip lines that are only a firm name with no verdict nearby.
- Return {"lines": []} if no records found. Never fabricate. Never narrate.`;

export async function parseApprovalReply(input: {
  text: string;
  campaignId: string;
}): Promise<ParseApprovalReplyResult> {
  const { text, campaignId } = input;

  if (!campaignId) return { ok: false, error: "campaignId required" };
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    return { ok: false, error: "Reply body is empty — paste text into the box first." };
  }
  if (trimmed.length > 40_000) {
    return {
      ok: false,
      error: `Reply body is ${trimmed.length.toLocaleString()} chars — max 40,000. Trim the quoted history and retry.`,
    };
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error:
        "OPENROUTER_API_KEY missing in .env.local — add the key and restart the dev server. The drop-zone cannot parse without it.",
    };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  // 1. Call the model with strict JSON instructions.
  let parsedLines: ParsedLine[];
  try {
    const content = await callOpenRouter({
      model: HAIKU_MODEL,
      max_tokens: 16000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: trimmed },
      ],
    });
    parsedLines = extractLines(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("parseApprovalReply: model call failed", msg);
    return { ok: false, error: `Model call failed: ${msg}` };
  }

  if (parsedLines.length === 0) {
    return {
      ok: true,
      matches: [],
      unmatched: [],
      parsed_count: 0,
      model: HAIKU_MODEL,
    };
  }

  // 2. Pull the in-campaign investor pool (matching is scoped here, same
  //    safeguard as the Python script's `fetch_investors_in_campaign`).
  const { pool, error: poolError } = await fetchCampaignInvestorPool(campaignId);
  if (poolError) {
    return { ok: false, error: poolError };
  }

  // 3. Fuzzy-match each line against the pool.
  const matches: ApprovalMatch[] = [];
  const unmatched: UnmatchedLine[] = [];

  for (const line of parsedLines) {
    const { match, reason } = matchFirm(line.investor_name, pool);
    if (!match || (reason !== "exact" && reason !== "contains" && reason !== "token_subset")) {
      unmatched.push({
        reply_name: line.investor_name,
        verdict: line.verdict,
        note: line.note,
        reason: reason === "ambiguous" ? "ambiguous" : "none",
        confidence: line.confidence,
      });
      continue;
    }
    matches.push({
      campaign_partner_id: match.campaign_partner_id,
      investor_id: match.investor_id,
      firm_name: match.firm_name,
      current_status_code: match.current_status_code,
      current_status_label: match.current_status_label,
      current_approver_note: match.current_approver_note,
      proposed_verdict: line.verdict,
      proposed_note: line.note,
      reply_name: line.investor_name,
      match_reason: reason,
      confidence: line.confidence,
    });
  }

  return {
    ok: true,
    matches,
    unmatched,
    parsed_count: parsedLines.length,
    model: HAIKU_MODEL,
  };
}

/* -------------------------------------------------------------------------- */
/* applyApprovalVerdicts                                                      */
/* -------------------------------------------------------------------------- */

export interface VerdictInstruction {
  campaign_partner_id: string;
  verdict: Verdict;
  /** Free-text note to merge into approver_note. Optional. */
  note?: string;
  /** Optional approver email — typed into the drop-zone by Tristan. */
  approver_email?: string;
  /** Haiku-reported confidence 0.0–1.0. Persisted to
   *  `campaign_partners.parse_confidence` (migration 028) so the /approval
   *  Step 3 row badge can render a coloured tier and so any future
   *  batch-override UI has the signal available. UX audit 2026-04-23
   *  item #12. */
  confidence?: number | null;
}

export type ApplyApprovalVerdictsResult =
  | {
      ok: true;
      applied: number;
      failed: Array<{ campaign_partner_id: string; error: string }>;
    }
  | { ok: false; error: string };

export async function applyApprovalVerdicts(input: {
  campaignId: string;
  verdicts: VerdictInstruction[];
}): Promise<ApplyApprovalVerdictsResult> {
  const { campaignId, verdicts } = input;
  if (!campaignId) return { ok: false, error: "campaignId required" };
  if (!Array.isArray(verdicts) || verdicts.length === 0) {
    return { ok: false, error: "No verdicts to apply" };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10); // YYYY-MM-DD for note prefix
  let applied = 0;
  const failed: Array<{ campaign_partner_id: string; error: string }> = [];

  for (const instruction of verdicts) {
    // Fetch the current row so we preserve existing approver_note history.
    const { data: currentRow, error: fetchErr } = await supabase
      .from("campaign_partners")
      .select("id, status_code, approver_note")
      .eq("id", instruction.campaign_partner_id)
      .eq("campaign_id", campaignId) // guard against cross-campaign writes
      .maybeSingle();

    if (fetchErr || !currentRow) {
      failed.push({
        campaign_partner_id: instruction.campaign_partner_id,
        error: fetchErr?.message ?? "Row not found on this campaign",
      });
      continue;
    }

    const approverEmail = instruction.approver_email?.trim() || user.email || null;
    const payload = buildUpdatePayload({
      verdict: instruction.verdict,
      note: instruction.note?.trim() || "",
      approver_email: approverEmail,
      existing_note: currentRow.approver_note as string | null,
      now_iso: nowIso,
      today,
      confidence:
        typeof instruction.confidence === "number" &&
        Number.isFinite(instruction.confidence)
          ? Math.max(0, Math.min(1, instruction.confidence))
          : null,
    });

    const { error: updateErr } = await supabase
      .from("campaign_partners")
      .update(payload)
      .eq("id", instruction.campaign_partner_id);

    if (updateErr) {
      failed.push({
        campaign_partner_id: instruction.campaign_partner_id,
        error: updateErr.message,
      });
      continue;
    }

    // Log a contact_event so the history is auditable alongside other
    // status changes (matches updateCampaignPartnerStatus behaviour).
    await supabase.from("contact_events").insert({
      campaign_partner_id: instruction.campaign_partner_id,
      direction: "inbound",
      channel: "email",
      event_type: "approver_reply",
      event_at: nowIso,
      summary:
        `[${instruction.verdict}] ${instruction.note?.trim() || ""}`.trim(),
    });

    applied += 1;
  }

  revalidatePath("/approval");
  revalidatePath("/tracker");
  return { ok: true, applied, failed };
}

/* -------------------------------------------------------------------------- */
/* Helpers — Haiku response parsing                                           */
/* -------------------------------------------------------------------------- */

function extractLines(raw: string): ParsedLine[] {
  // Haiku sometimes wraps JSON in ```json fences. Strip them defensively.
  let jsonText = raw.trim();
  if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  // Find first '{' and last '}' — survives trailing narration.
  const firstBrace = jsonText.indexOf("{");
  const lastBrace = jsonText.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    jsonText = jsonText.slice(firstBrace, lastBrace + 1);
  }
  let obj: unknown;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!obj || typeof obj !== "object") return [];
  const lines = (obj as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return [];

  const out: ParsedLine[] = [];
  for (const entry of lines) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.investor_name === "string" ? e.investor_name.trim() : "";
    const verdict = typeof e.verdict === "string" ? e.verdict.toLowerCase() : "";
    const note = typeof e.note === "string" ? e.note.trim() : "";
    const source = typeof e.source === "string" ? e.source : "";
    // Confidence is a new field (2026-04-23, UX audit item #12). Parse
    // defensively — Haiku may still return a reply without it if the
    // system prompt was truncated or the model version lags. Clamp to
    // [0, 1] so downstream UI doesn't have to guard against rubbish.
    let confidence: number | null = null;
    if (typeof e.confidence === "number" && Number.isFinite(e.confidence)) {
      confidence = Math.max(0, Math.min(1, e.confidence));
    } else if (typeof e.confidence === "string") {
      const parsed = Number.parseFloat(e.confidence);
      if (Number.isFinite(parsed)) {
        confidence = Math.max(0, Math.min(1, parsed));
      }
    }
    if (!name) continue;
    if (!isVerdict(verdict)) continue;
    out.push({ investor_name: name, verdict, note, source, confidence });
  }
  return out;
}

function isVerdict(v: string): v is Verdict {
  return v === "ok" || v === "not_for_me" || v === "skip" || v === "maybe";
}

/* -------------------------------------------------------------------------- */
/* Helpers — in-campaign investor pool                                        */
/* -------------------------------------------------------------------------- */

interface PoolRow {
  campaign_partner_id: string;
  investor_id: number;
  firm_name: string | null;
  current_status_code: string | null;
  current_status_label: string | null;
  current_approver_note: string | null;
}

interface PoolJoinRow {
  id: string;
  status_code: string | null;
  status_label: string | null;
  approver_note: string | null;
  partners_mirror: {
    investors_mirror: {
      id: number;
      firm_name: string | null;
    } | null;
  } | null;
}

async function fetchCampaignInvestorPool(
  campaignId: string,
): Promise<{ pool: PoolRow[]; error: string | null }> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("campaign_partners")
    .select(
      `
      id,
      status_code,
      status_label,
      approver_note,
      partners_mirror:partner_id (
        investors_mirror:investor_id (
          id,
          firm_name
        )
      )
      `,
    )
    .eq("campaign_id", campaignId)
    .limit(5000);

  if (error) {
    return { pool: [], error: `Campaign pool fetch failed: ${error.message}` };
  }

  const rows = (data ?? []) as unknown as PoolJoinRow[];
  const pool: PoolRow[] = [];
  for (const r of rows) {
    const investor = r.partners_mirror?.investors_mirror ?? null;
    if (!investor || investor.id == null) continue;
    pool.push({
      campaign_partner_id: r.id,
      investor_id: investor.id,
      firm_name: investor.firm_name,
      current_status_code: r.status_code,
      current_status_label: r.status_label,
      current_approver_note: r.approver_note,
    });
  }
  return { pool, error: null };
}

/* -------------------------------------------------------------------------- */
/* Helpers — fuzzy firm matching (mirrors the Python script)                   */
/* -------------------------------------------------------------------------- */

const STOPWORDS = new Set([
  "the",
  "and",
  "of",
  "inc",
  "ltd",
  "llc",
  "plc",
  "vc",
  "ventures",
  "capital",
  "partners",
  "fund",
  "funds",
  "co",
  "company",
  "group",
  "holdings",
]);

function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenise(name: string): Set<string> {
  const toks = normalise(name).split(/\s+/).filter(Boolean);
  return new Set(toks.filter((t) => !STOPWORDS.has(t)));
}

interface MatchResult {
  match: PoolRow | null;
  reason: "exact" | "contains" | "token_subset" | "ambiguous" | "none";
}

function matchFirm(query: string, candidates: PoolRow[]): MatchResult {
  if (!query || candidates.length === 0) {
    return { match: null, reason: "none" };
  }
  const qNorm = normalise(query);
  if (!qNorm) return { match: null, reason: "none" };

  // 1. exact (case-insensitive, punctuation-normalised)
  const exact = candidates.filter(
    (c) => normalise(c.firm_name ?? "") === qNorm,
  );
  if (exact.length === 1) return { match: exact[0], reason: "exact" };
  if (exact.length > 1) return { match: null, reason: "ambiguous" };

  // 2. contains (either direction)
  const contains = candidates.filter((c) => {
    const cn = normalise(c.firm_name ?? "");
    return cn && (cn.includes(qNorm) || qNorm.includes(cn));
  });
  if (contains.length === 1) return { match: contains[0], reason: "contains" };
  if (contains.length > 1) {
    contains.sort((a, b) => (a.firm_name ?? "").length - (b.firm_name ?? "").length);
    const [first, second] = contains;
    if ((first.firm_name ?? "").length === (second.firm_name ?? "").length) {
      return { match: null, reason: "ambiguous" };
    }
    return { match: first, reason: "contains" };
  }

  // 3. token-subset: all non-stopword query tokens appear in candidate
  const qToks = tokenise(query);
  if (qToks.size === 0) return { match: null, reason: "none" };
  const tokenHits = candidates.filter((c) => {
    const cToks = tokenise(c.firm_name ?? "");
    for (const t of qToks) {
      if (!cToks.has(t)) return false;
    }
    return true;
  });
  if (tokenHits.length === 1) {
    return { match: tokenHits[0], reason: "token_subset" };
  }
  if (tokenHits.length > 1) return { match: null, reason: "ambiguous" };

  return { match: null, reason: "none" };
}

/* -------------------------------------------------------------------------- */
/* Helpers — verdict → DB payload                                             */
/* -------------------------------------------------------------------------- */

const STATUS_APPROVED = "+1"; // Approved — awaiting draft
const STATUS_DISQUALIFIED = "-3"; // Disqualified
const STATUS_PENDING = "+0"; // Pending approval (unchanged for 'maybe')

function buildUpdatePayload(input: {
  verdict: Verdict;
  note: string;
  approver_email: string | null;
  existing_note: string | null;
  now_iso: string;
  today: string;
  /** Haiku-reported confidence — persisted verbatim on every verdict so
   *  the Step 3 table can render the coloured badge and so later batch
   *  operations can sort / filter by quality. */
  confidence: number | null;
}): Record<string, unknown> {
  const { verdict, note, approver_email, existing_note, now_iso, today, confidence } = input;

  // Every payload writes parse_confidence; null clears a prior score
  // which is the correct behaviour if a manual override replaces a
  // machine verdict. See migration 028.
  const confidencePayload: Record<string, unknown> = {
    parse_confidence: confidence,
  };

  if (verdict === "ok") {
    const payload: Record<string, unknown> = {
      status_code: STATUS_APPROVED,
      status_label: labelFor(STATUS_APPROVED),
      approved_by: approver_email,
      approved_at: now_iso,
      ...confidencePayload,
    };
    if (note) {
      payload.approver_note = mergeNote(existing_note, note, today);
    }
    return payload;
  }

  if (verdict === "not_for_me") {
    return {
      status_code: STATUS_DISQUALIFIED,
      status_label: labelFor(STATUS_DISQUALIFIED),
      approved_by: approver_email,
      approved_at: now_iso,
      approver_note: mergeNote(existing_note, note || "Not for us", today),
      ...confidencePayload,
    };
  }

  if (verdict === "skip") {
    return {
      status_code: STATUS_DISQUALIFIED,
      status_label: labelFor(STATUS_DISQUALIFIED),
      approved_by: approver_email,
      approved_at: now_iso,
      approver_note: mergeNote(
        existing_note,
        `[SKIP] ${note || "skip this one"}`,
        today,
      ),
      ...confidencePayload,
    };
  }

  // verdict === "maybe" — keep at +0 but flag the note so Tristan sees it.
  return {
    status_code: STATUS_PENDING,
    status_label: labelFor(STATUS_PENDING),
    approver_note: mergeNote(existing_note, `[FLAG] ${note || "maybe"}`, today),
    ...confidencePayload,
  };
}

function mergeNote(
  existing: string | null,
  incoming: string,
  today: string,
): string | null {
  const trimmed = incoming.trim();
  if (!trimmed) return existing;
  const stamped = `[${today}] ${trimmed}`;
  if (!existing || !existing.trim()) return stamped;
  return `${existing} | ${stamped}`;
}

// Assert STATUS_BY_CODE contains our expected codes at module load.
// Fails loudly if the legend is ever narrowed, which would break the
// payload builder silently otherwise.
void STATUS_BY_CODE[STATUS_APPROVED];
void STATUS_BY_CODE[STATUS_DISQUALIFIED];
void STATUS_BY_CODE[STATUS_PENDING];
