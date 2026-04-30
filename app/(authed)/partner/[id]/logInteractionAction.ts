"use server";

import { callOpenRouter } from "@/lib/openrouter";
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";

/**
 * CRM interaction logging — calls, meetings, LinkedIn messages,
 * personal notes, intel. Appends to contact_events alongside the
 * email touchpoints so the per-partner timeline stays one table.
 *
 * Flow:
 *   1. Founder records a call with Wispr (iOS/Mac voice-to-text).
 *   2. Opens the Log Interaction modal on a partner profile or
 *      tracker row drawer.
 *   3. Pastes the transcript into `notes`, fills type + duration +
 *      optional follow-up.
 *   4. Clicks "Synthesise with Opus" — action below calls Opus with
 *      the transcript + partner context, produces action items,
 *      intel, quotes, suggested status transition, suggested
 *      follow-up date. Writes the JSON to synthesised_actions.
 *   5. Submits — the row lands as a contact_events entry and the
 *      partner's timeline updates.
 */

// Structured transcript synthesis — use DeepSeek V4-Pro for reasoning quality.
const OPUS_MODEL = "deepseek/deepseek-v4-pro";

export interface LogInteractionInput {
  /** Partner being logged against — campaign_partner_id OR partner_id.
   *  We accept both and resolve to a campaign_partner_id (the timeline
   *  target) by picking the most recent campaign for the partner when
   *  only partner_id is supplied.
   */
  campaignPartnerId?: string;
  partnerId?: number;
  eventType:
    | "call"
    | "meeting"
    | "linkedin_message"
    | "linkedin_connect"
    | "whatsapp"
    | "slack"
    | "personal_note"
    | "handover_note"
    | "intel";
  channel?:
    | "call"
    | "zoom"
    | "google_meet"
    | "teams"
    | "in_person"
    | "linkedin"
    | "whatsapp"
    | "signal"
    | "slack"
    | "manual";
  eventAt: string; // ISO timestamp
  durationMinutes?: number;
  title?: string;
  notes?: string;
  followUpDueAt?: string; // ISO
  runSynthesis?: boolean;
}

export interface SynthesisedActions {
  summary: string[];
  action_items: Array<{
    text: string;
    owner: "tristan" | "company" | "investor";
    due_at_guess: string | null;
  }>;
  intel: string[];
  quotes: string[];
  suggested_status: string | null;
  suggested_follow_up_due_at: string | null;
}

export type LogInteractionResult =
  | {
      ok: true;
      contactEventId: string;
      synthesis: SynthesisedActions | null;
    }
  | { ok: false; error: string };

export async function logInteraction(
  input: LogInteractionInput,
): Promise<LogInteractionResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Resolve campaign_partner_id — either supplied directly, or we pick
  // the most recent one for this partner_id so standalone notes still
  // land on the partner's primary tracker timeline.
  let campaignPartnerId = input.campaignPartnerId ?? null;
  if (!campaignPartnerId) {
    if (!input.partnerId) {
      return {
        ok: false,
        error: "Need either campaignPartnerId or partnerId.",
      };
    }
    const { data: cp } = await supabase
      .from("campaign_partners")
      .select("id, created_at")
      .eq("partner_id", input.partnerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!cp) {
      return {
        ok: false,
        error: `No campaign_partners row for partner ${input.partnerId} — cannot attach interaction.`,
      };
    }
    campaignPartnerId = (cp as { id: string }).id;
  }

  // Run synthesis before insert if requested and notes are long
  // enough to be worth synthesising.
  let synthesis: SynthesisedActions | null = null;
  if (
    input.runSynthesis &&
    input.notes &&
    input.notes.trim().length >= 120
  ) {
    const result = await synthesiseNotes({
      campaignPartnerId,
      notes: input.notes,
      eventType: input.eventType,
      title: input.title ?? null,
    });
    if (result.ok) synthesis = result.synthesis;
  }

  const defaultChannel: LogInteractionInput["channel"] =
    input.eventType === "call"
      ? "call"
      : input.eventType === "meeting"
        ? "in_person"
        : input.eventType === "linkedin_message" ||
            input.eventType === "linkedin_connect"
          ? "linkedin"
          : input.eventType === "whatsapp"
            ? "whatsapp"
            : input.eventType === "slack"
              ? "slack"
              : "manual";
  const direction =
    input.eventType === "call" || input.eventType === "meeting"
      ? "meeting"
      : input.eventType === "personal_note" ||
          input.eventType === "intel" ||
          input.eventType === "handover_note"
        ? "note"
        : "outbound";

  const { data, error } = await supabase
    .from("contact_events")
    .insert({
      campaign_partner_id: campaignPartnerId,
      event_type: input.eventType,
      event_at: input.eventAt,
      direction,
      channel: input.channel ?? defaultChannel,
      title: input.title ?? null,
      summary: input.title ?? null,
      notes: input.notes ?? null,
      duration_minutes: input.durationMinutes ?? null,
      follow_up_due_at: input.followUpDueAt ?? null,
      synthesised_actions: synthesis,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      error: `Insert failed: ${error?.message ?? "no row returned"}`,
    };
  }

  // Bump last_contact_at on the campaign_partners row so tracker
  // "days since contact" stays current.
  await supabase
    .from("campaign_partners")
    .update({ last_contact_at: input.eventAt })
    .eq("id", campaignPartnerId);

  revalidatePath("/tracker");
  revalidatePath("/follow-ups");
  revalidatePath(`/partner/${input.partnerId ?? ""}`);

  return { ok: true, contactEventId: (data as { id: string }).id, synthesis };
}

/* ------------------------------------------------------------ */

interface SynthesiseInput {
  campaignPartnerId: string;
  notes: string;
  eventType: string;
  title: string | null;
}

export type SynthesiseResult =
  | { ok: true; synthesis: SynthesisedActions }
  | { ok: false; error: string };

export async function synthesiseNotes(
  input: SynthesiseInput,
): Promise<SynthesiseResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { ok: false, error: "OPENROUTER_API_KEY not set." };

  const supabase = await createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Not signed in." };

  // Pull context for the prompt so Opus has firm + campaign + prior
  // status to reason about status transitions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await supabase
    .from("campaign_partners")
    .select(
      `id, status_code, status_label,
       campaign:campaigns (name, campaign_intent, company_description, raise_size),
       partner:partners_mirror (
         name, title, email,
         investor:investors_mirror (firm_name, thesis_summary, sector_focus)
       )`,
    )
    .eq("id", input.campaignPartnerId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = row as any;
  const firmName = r?.partner?.investor?.firm_name ?? "(unknown firm)";
  const partnerName = r?.partner?.name ?? "(unknown)";
  const campaignName = r?.campaign?.name ?? "(unnamed campaign)";
  const currentStatus = r?.status_code ?? "(no status)";

  const system = [
    "You synthesise a call transcript / meeting note on Tristan Fischer's behalf. Tristan is a fundraising advisor running cold outreach for a capital-intensive portfolio company. The transcript may be a Wispr voice-to-text paste (dictated, messy) or typed notes. Extract structured signal from it.",
    "",
    "Output ONLY one JSON object, no prose, no markdown fence, matching this schema:",
    "  {",
    '    "summary": ["<2-4 bullets summarising the call>"],',
    '    "action_items": [{"text": "<do X>", "owner": "tristan" | "company" | "investor", "due_at_guess": "YYYY-MM-DD" | null}],',
    '    "intel": ["<fact about the firm/investor worth remembering for future touches>"],',
    '    "quotes": ["<verbatim nugget worth keeping, 10-30 words>"],',
    '    "suggested_status": "+N" | "-N" | null,',
    '    "suggested_follow_up_due_at": "YYYY-MM-DD" | null',
    "  }",
    "",
    "Rules:",
    "  - British spelling. Specific nouns over adjectives. No flattery.",
    "  - suggested_status values from the 16-code vocabulary: +12 Committed, +11 Term sheet, +10 NDA/diligence, +9 Meeting held, +8 Meeting scheduled, +7 Meeting offered, +6.5 Handover to company, +6 Response received, +5 Follow-up sent, +4 Auto-reply/OOO, +3 Email sent, +2 Drafted, +1 Approved, +0 Pending, -1 Declined, -2 Bounced, -3 Disqualified. Return null if the call doesn't clearly shift status.",
    "  - action_items owner = 'tristan' for things he does; 'company' for things Stephan/Andrew/Andreas do; 'investor' for things the investor committed to.",
    "  - due_at_guess only when the call named a specific date or 'next week' / 'in X weeks' — compute from today; null when unspecified.",
    "  - Intel is for lasting facts (they are launching fund IV, Marianne is moving to Latitude next month, they only write second cheques after a named co-lead).",
    "  - Quotes are verbatim — copy-paste, don't paraphrase.",
    "  - NO bracketed placeholders like [X].",
  ].join("\n");

  const userPrompt = [
    `CONTEXT:`,
    `  Campaign: ${campaignName}`,
    `  Firm: ${firmName}`,
    `  Contact: ${partnerName}`,
    `  Current status: ${currentStatus}`,
    `  Event type: ${input.eventType}`,
    input.title ? `  Title: ${input.title}` : null,
    ``,
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    ``,
    `TRANSCRIPT / NOTES:`,
    `---`,
    input.notes.trim().slice(0, 30_000),
    `---`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const raw = await callOpenRouter({
      model: OPUS_MODEL,
      max_tokens: 16000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
    });
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    let parsed: Partial<SynthesisedActions>;
    try {
      parsed = JSON.parse(cleaned) as Partial<SynthesisedActions>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "parse error";
      return {
        ok: false,
        error: `Model returned non-JSON (${msg}). Raw: ${raw.slice(0, 200)}`,
      };
    }

    const synthesis: SynthesisedActions = {
      summary: Array.isArray(parsed.summary)
        ? parsed.summary.filter((s): s is string => typeof s === "string")
        : [],
      action_items: Array.isArray(parsed.action_items)
        ? parsed.action_items.filter(
            (a): a is SynthesisedActions["action_items"][number] =>
              !!a && typeof a === "object" && typeof (a as { text?: unknown }).text === "string",
          )
        : [],
      intel: Array.isArray(parsed.intel)
        ? parsed.intel.filter((s): s is string => typeof s === "string")
        : [],
      quotes: Array.isArray(parsed.quotes)
        ? parsed.quotes.filter((s): s is string => typeof s === "string")
        : [],
      suggested_status:
        typeof parsed.suggested_status === "string"
          ? parsed.suggested_status
          : null,
      suggested_follow_up_due_at:
        typeof parsed.suggested_follow_up_due_at === "string"
          ? parsed.suggested_follow_up_due_at
          : null,
    };

    return { ok: true, synthesis };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Synthesis failed: ${msg}` };
  }
}

/* ------------------------------------------------------------ */

/**
 * Mark a follow-up as done without logging a new interaction.
 * Used by the "Snooze / complete" affordances on /follow-ups.
 */
export async function markFollowUpDone(
  contactEventId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!contactEventId) return { ok: false, error: "id required" };
  const supabase = await createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Not signed in." };
  const { error } = await supabase
    .from("contact_events")
    .update({ follow_up_done_at: new Date().toISOString() })
    .eq("id", contactEventId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/follow-ups");
  revalidatePath("/tracker");
  return { ok: true };
}
