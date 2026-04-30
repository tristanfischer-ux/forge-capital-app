"use server";

import { callOpenRouter } from "@/lib/openrouter";
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getGmailThread } from "@/lib/gmail/read-thread";
import { sendGmailMessage } from "@/lib/gmail/create-draft";
import { getInvestorModalData } from "@/lib/queries/investorModal";
import { isSelfManaged } from "@/lib/queries/self-managed";
import { STATUS_BY_CODE } from "@/lib/status-codes";

/**
 * Reply-ingestion + response-drafting surface actions.
 *
 * Flow:
 *   1. loadTestReplies — for every test_send contact_event on the
 *      campaign, fetch the Gmail thread and return any inbound messages
 *      that weren't sent by the current user.
 *   2. classifyAndDraftResponse — per reply, Opus classifies
 *      sentiment (positive / negative / neutral) and drafts an
 *      appropriate response paragraph.
 *   3. sendResponseAndUpdateStatus — sends the response via Gmail AND
 *      updates the campaign_partners row status based on the sentiment:
 *      positive → +7 Meeting offered, negative → -1 Declined,
 *      neutral → +5 Follow-up sent. Logs a contact_events row for the
 *      inbound reply AND the outbound response.
 *
 * All three are separate actions so the UI can stream (fetch → classify
 * → one-click-send) without blocking on slow Opus calls.
 */

// classifyAndDraftResponse uses GPT-4.1 (voice-critical reply drafting).
// dispatchApprovedResponses uses DeepSeek V4-Pro (structured parsing).
const CLASSIFY_DRAFT_MODEL = "openai/gpt-4.1";
const DISPATCH_PARSE_MODEL = "deepseek/deepseek-v4-pro";

export interface TestReplyRow {
  campaignPartnerId: string;
  firmName: string | null;
  partnerName: string | null;
  partnerEmail: string | null;
  gmailThreadId: string;
  outboundSubject: string | null;
  /** The most recent inbound reply on the thread (if any). */
  replyFrom: string | null;
  replyBody: string | null;
  replyInternalDate: number | null;
  replyMessageId: string | null;
  /** Already-computed classification cached on the partner row (null on first read). */
  cachedSentiment: Sentiment | null;
  /** Already-computed Opus-drafted response (null on first read). */
  cachedDraftResponse: string | null;
  /** Current tracker status — so the UI can show the transition to the user. */
  statusCode: string | null;
}

export interface LoadTestRepliesResult {
  ok: true;
  rows: TestReplyRow[];
  userEmail: string | null;
}

export async function loadTestReplies(input: {
  campaignId: string;
}): Promise<LoadTestRepliesResult | { ok: false; error: string }> {
  const { campaignId } = input;
  if (!campaignId) return { ok: false, error: "campaignId required." };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Fetch all test_send events for the campaign via a join through
  // campaign_partners.campaign_id.
  const { data: events, error } = await supabase
    .from("contact_events")
    .select(
      `
      id,
      campaign_partner_id,
      gmail_thread_id,
      summary,
      event_at,
      campaign_partners:campaign_partner_id (
        campaign_id,
        status_code,
        reply_sentiment,
        drafted_response,
        partners_mirror:partner_id (
          name,
          email,
          investors_mirror:investor_id (
            firm_name
          )
        )
      )
      `,
    )
    .eq("event_type", "test_send")
    .order("event_at", { ascending: false });
  if (error) return { ok: false, error: `read failed: ${error.message}` };

  // Filter to the requested campaign.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matching = ((events ?? []) as any[]).filter(
    (e) => e.campaign_partners?.campaign_id === campaignId,
  );

  const rows: TestReplyRow[] = [];
  let userEmail: string | null = null;

  for (const e of matching) {
    const threadId = e.gmail_thread_id as string | null;
    if (!threadId) continue;

    const partner = e.campaign_partners?.partners_mirror ?? null;
    const investor = partner?.investors_mirror ?? null;

    let replyFrom: string | null = null;
    let replyBody: string | null = null;
    let replyInternalDate: number | null = null;
    let replyMessageId: string | null = null;

    try {
      const thread = await getGmailThread(threadId);
      userEmail = thread.userEmail ?? userEmail;
      // Sort messages by internalDate ascending so we can pick the last
      // non-user message as the "current reply to respond to".
      const sorted = [...thread.messages].sort(
        (a, b) => a.internalDate - b.internalDate,
      );
      for (const m of sorted) {
        if (m.isFromUser) continue;
        replyFrom = m.from;
        replyBody = m.body;
        replyInternalDate = m.internalDate;
        replyMessageId = m.id;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`getGmailThread ${threadId} failed:`, msg);
    }

    rows.push({
      campaignPartnerId: e.campaign_partner_id,
      firmName: investor?.firm_name ?? null,
      partnerName: partner?.name ?? null,
      partnerEmail: partner?.email ?? null,
      gmailThreadId: threadId,
      outboundSubject: (e.summary as string | null) ?? null,
      replyFrom,
      replyBody,
      replyInternalDate,
      replyMessageId,
      cachedSentiment: e.campaign_partners?.reply_sentiment ?? null,
      cachedDraftResponse: e.campaign_partners?.drafted_response ?? null,
      statusCode: e.campaign_partners?.status_code ?? null,
    });
  }

  return { ok: true, rows, userEmail };
}

export interface ClassifyResponseInput {
  campaignPartnerId: string;
  replyBody: string;
}
export type Sentiment = "positive" | "negative" | "neutral" | "handover";

export type ClassifyResponseResult =
  | {
      ok: true;
      sentiment: Sentiment;
      reasons: string[];
      draftResponse: string;
    }
  | { ok: false; error: string };

export async function classifyAndDraftResponse(
  input: ClassifyResponseInput,
): Promise<ClassifyResponseResult> {
  const { campaignPartnerId, replyBody } = input;
  if (!campaignPartnerId || !replyBody?.trim()) {
    return { ok: false, error: "campaignPartnerId + replyBody required." };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { ok: false, error: "OPENROUTER_API_KEY not set." };

  const data = await getInvestorModalData(campaignPartnerId);
  if (!data) return { ok: false, error: "Partner not found." };

  // Fetch counterpart_email off the campaign row — InvestorModalData's
  // campaign shape doesn't include it. This is what drives the
  // self-managed branch (no external company-side to hand over to).
  let campaignRow: {
    id: string;
    counterpart_email: string | null;
    counterpart_name: string | null;
  } | null = null;
  if (data.campaign?.id) {
    const supabase = await createServerClient();
    const { data: campRow } = await supabase
      .from("campaigns")
      .select("id, counterpart_email, counterpart_name")
      .eq("id", data.campaign.id)
      .maybeSingle();
    campaignRow = (campRow as typeof campaignRow) ?? null;
  }
  const selfManaged = isSelfManaged(campaignRow);

  const firmName = data.investor.firm_name ?? "the firm";
  const firstName =
    (data.primary_partner?.name ?? "").trim().split(/\s+/)[0] || "there";
  const founderBio = data.campaign?.company_description ?? "";

  const systemLines = [
    "You are a senior fundraising-operations analyst supporting Tristan Fischer. You read an investor's reply to a cold outreach email and do TWO things:",
    "  1. Classify sentiment as 'positive' | 'negative' | 'neutral' | 'handover'. Use these definitions:",
    "     - positive: expresses any interest — 'happy to meet', 'interested', 'send me the deck', 'book a call', even cautious interest like 'we could look at this'. Tristan auto-responds with calendar slots (transition to +7 Meeting offered).",
    "     - negative: explicit no — 'not for us', 'out of thesis', 'we pass', 'unfortunately no', or an obvious decline (transition to -1 Declined).",
    "     - neutral: neither — asks a factual question, redirects to a colleague, says 'now is not the right time but maybe later' (transition to +5 Follow-up sent).",
    "     - handover: the reply is warm enough that Tristan should pass the dialogue to the company side (Stephan Wrage for SkySails, Andrew Robertson for FishFrom, Andreas Cser for Panatere). Use this when the investor asks specifics the company CEO would need to answer, OR requests a meeting with the CEO directly, OR has moved past 'interested in principle' to 'let's get the detail'. Tristan does not auto-respond — he sends a handover email to the company contact and the row goes to +6.5 Handover to company (his terminal state per Rule 8).",
    "  2. Draft a short response in Tristan's first-person British voice. NEVER flatter ('congratulations', 'great to see', etc.).",
    "     - positive: thank briefly, propose 3 specific 30-minute slots over the next 10 working days in BST, offer to send the deck ahead.",
    "     - negative: thank, acknowledge, leave the door open for future, do not argue.",
    "     - neutral: answer any question if one was asked, otherwise gently probe for more info.",
    "     - handover: draft text TO THE COMPANY CONTACT (not the investor), introducing the investor and the context of the reply. Frame: 'Hi <company-contact>, <investor-firm> replied to my cold email with the following — looks warm enough to hand over. <verbatim or paraphrased reply>. Happy to pass the thread to you so you can take it from here.'",
    "Output ONLY a JSON object: {\"sentiment\": \"<bucket>\", \"reasons\": [\"<short bullet>\", ...], \"draft_response\": \"<paragraph>\"} — no prose, no markdown fence. British spelling. Never invent facts outside the provided context. NO bracketed placeholders like [X] / [name].",
  ];
  if (selfManaged) {
    // Bias Opus upstream: no external company side exists to hand over
    // to, so the handover bucket + handover-voice draft would both be
    // wasted output. Re-point handover-worthy replies at positive so
    // warm interest receives calendar slots.
    systemLines.push(
      "This campaign is self-managed — the founder does not hand dialogue over to a separate company side. If you would have picked `handover`, pick `positive` instead.",
    );
  }
  const system = systemLines.join("\n");

  const userPrompt = [
    `INVESTOR FIRM: ${firmName}`,
    `INVESTOR CONTACT: ${data.primary_partner?.name ?? "unknown"}`,
    `CAMPAIGN: ${data.campaign?.name ?? "(unnamed)"}`,
    founderBio ? `COMPANY CONTEXT: ${founderBio}` : null,
    "",
    "INVESTOR'S REPLY (verbatim):",
    "---",
    replyBody.trim(),
    "---",
    "",
    `For the draft_response, address the investor by first name (${firstName}). Sign off simply "Best regards, Tristan" — no LinkedIn URL, no email signature block (the outbound email client adds those).`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const raw = await callOpenRouter({
      model: CLASSIFY_DRAFT_MODEL,
      max_tokens: 1200,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
    });
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    let parsed: {
      sentiment: unknown;
      reasons: unknown;
      draft_response: unknown;
    };
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "parse error";
      return { ok: false, error: `Model returned non-JSON (${msg}). Raw: ${raw.slice(0, 160)}` };
    }

    const sentiment =
      parsed.sentiment === "positive" ||
      parsed.sentiment === "negative" ||
      parsed.sentiment === "neutral" ||
      parsed.sentiment === "handover"
        ? (parsed.sentiment as Sentiment)
        : null;
    const draftResponse =
      typeof parsed.draft_response === "string"
        ? parsed.draft_response.trim()
        : "";
    const reasons = Array.isArray(parsed.reasons)
      ? parsed.reasons
          .filter((r): r is string => typeof r === "string")
          .map((r) => r.trim())
          .filter(Boolean)
      : [];

    if (!sentiment) return { ok: false, error: "Opus didn't return a valid sentiment bucket." };
    if (!draftResponse) return { ok: false, error: "Opus didn't return a draft response." };
    if (/\[[^\]\n]{2,60}\]/.test(draftResponse)) {
      return {
        ok: false,
        error: "Opus draft contained a [bracketed placeholder]. Re-run.",
      };
    }

    // Defensive remap: Opus may still return `handover` on a self-managed
    // campaign (the bias sentence is guidance, not a hard gate). On
    // self-managed campaigns, treat it as `positive` — the status + the
    // drafted-response voice both need to route to the meeting-offer
    // branch, never to a +6.5 handover message nobody receives.
    const effective: Sentiment =
      selfManaged && sentiment === "handover" ? "positive" : sentiment;

    // Cache sentiment + draft on the campaign_partners row so the UI can
    // reload without re-hitting Opus.
    const supabase = await createServerClient();
    await supabase
      .from("campaign_partners")
      .update({
        reply_sentiment: effective,
        drafted_response: draftResponse,
      })
      .eq("id", campaignPartnerId);

    return { ok: true, sentiment: effective, reasons, draftResponse };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Model call failed: ${msg}` };
  }
}

export interface SendResponseInput {
  campaignPartnerId: string;
  toEmail: string;
  subject: string;
  body: string;
  sentiment: Sentiment;
  gmailThreadId: string;
}

export type SendResponseResult =
  | { ok: true; threadId: string; newStatusCode: string }
  | { ok: false; error: string };

/* ============================================================ */
/* Spreadsheet-style approval flow                                */
/* ============================================================ */

/**
 * Generate a plain-text "response sheet" of every inbound reply with
 * its Opus-classified sentiment + drafted response, email it to the
 * founder's review inbox. They reply with `y / no / edit` per row; the
 * paste parser below ingests their reply and dispatches the approved
 * responses in one go.
 *
 * This replaces the per-row click UX that Tristan flagged 2026-04-23
 * as clunky: "going through one email after another investor after
 * another like that with pressing okay is probably not as good as
 * them receiving a spreadsheet".
 */
export interface EmailSheetInput {
  campaignId: string;
  toEmail: string;
}

export type EmailSheetResult =
  | { ok: true; rowCount: number; threadId: string }
  | { ok: false; error: string };

export async function emailResponseSheet(
  input: EmailSheetInput,
): Promise<EmailSheetResult> {
  const { campaignId, toEmail } = input;
  if (!campaignId) return { ok: false, error: "campaignId required." };
  if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return { ok: false, error: "Invalid toEmail." };
  }

  // Reuse the existing loader — it fetches every test_send thread and
  // picks the most recent inbound message.
  const loaded = await loadTestReplies({ campaignId });
  if (!loaded.ok) return { ok: false, error: loaded.error };

  const rowsWithReply = loaded.rows.filter((r) => r.replyBody);
  if (rowsWithReply.length === 0) {
    return {
      ok: false,
      error: "No inbound replies on this campaign yet — nothing to sheet.",
    };
  }

  // Classify + draft for any row that doesn't already have a cached
  // classification. This is where the expensive work lives — up to N
  // sequential Opus calls. Re-uses the same Opus prompt as the per-row
  // UI path.
  for (const row of rowsWithReply) {
    if (!row.cachedSentiment || !row.cachedDraftResponse) {
      if (!row.replyBody) continue;
      await classifyAndDraftResponse({
        campaignPartnerId: row.campaignPartnerId,
        replyBody: row.replyBody,
      });
    }
  }

  // Re-load so we have the latest cached values.
  const reloaded = await loadTestReplies({ campaignId });
  if (!reloaded.ok) return { ok: false, error: reloaded.error };
  const finalRows = reloaded.rows.filter((r) => r.replyBody);

  const today = new Date().toISOString().slice(0, 10);
  const subject = `[APPROVAL] ${finalRows.length} responses awaiting your approval · ${today}`;

  const lines: string[] = [];
  lines.push(
    `Hi,`,
    ``,
    `${finalRows.length} investor replies have come in. For each row below, choose one of:`,
    ``,
    `  y        — send the drafted response as-is`,
    `  no       — skip this one, I'll handle manually`,
    `  edit: <your rewrite>  — paste a replacement response on the row`,
    ``,
    `Reply to this email with your annotations. The app parses your reply and dispatches the approved responses + updates the tracker (positive → +7 Meeting offered, negative → -1 Declined, neutral → +5 Follow-up sent).`,
    ``,
    `— Tristan`,
    ``,
    `===============`,
    ``,
  );

  finalRows.forEach((r, i) => {
    const num = i + 1;
    const sentiment = (r.cachedSentiment ?? "unclassified").toUpperCase();
    lines.push(`${num}. ${r.firmName ?? "—"}${r.partnerName ? ` · ${r.partnerName}` : ""}`);
    if (r.replyFrom) lines.push(`   FROM: ${r.replyFrom}`);
    lines.push(``);
    lines.push(`   THEIR REPLY:`);
    const snippet = (r.replyBody ?? "").replace(/\n{2,}/g, "\n").slice(0, 700);
    snippet.split("\n").forEach((l) => lines.push(`   > ${l}`));
    lines.push(``);
    lines.push(`   OPUS READ: ${sentiment}`);
    lines.push(``);
    lines.push(`   PROPOSED RESPONSE:`);
    (r.cachedDraftResponse ?? "(no draft yet)")
      .split("\n")
      .forEach((l) => lines.push(`   | ${l}`));
    lines.push(``);
    lines.push(`   DECISION: ___  (y / no / edit: <your rewrite>)`);
    lines.push(``);
    lines.push(`   ---`);
    lines.push(``);
  });

  try {
    const sent = await sendGmailMessage({
      to: toEmail,
      subject,
      body: lines.join("\n"),
    });
    return {
      ok: true,
      rowCount: finalRows.length,
      threadId: sent.threadId,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Gmail send failed: ${msg}` };
  }
}

/* --------------------------------------------------- */

/**
 * Parse Tristan's approved response sheet and dispatch each approved
 * row's response via Gmail + transition the tracker status.
 *
 * The parser uses Opus — Tristan's annotations are free-form prose on
 * the same email thread, not structured markup. Opus reads the
 * original sheet contents (we re-generate it fresh to avoid stale
 * state) alongside his reply text and produces a JSON per-row:
 *   {index: N, decision: "send" | "skip" | "edit", edited_text?: "..."}
 *
 * Then for each "send" or "edit" row we call sendGmailMessage +
 * update the campaign_partners row status using the cached
 * sentiment bucket.
 */
export interface DispatchSheetInput {
  campaignId: string;
  approvedText: string;
}

export interface DispatchRowOutcome {
  campaignPartnerId: string;
  firmName: string | null;
  decision: "send" | "edit" | "skip" | "unparsed";
  ok: boolean;
  detail: string;
}

export type DispatchSheetResult =
  | {
      ok: true;
      sent: number;
      skipped: number;
      failed: number;
      rows: DispatchRowOutcome[];
    }
  | { ok: false; error: string };

export async function dispatchApprovedResponses(
  input: DispatchSheetInput,
): Promise<DispatchSheetResult> {
  const { campaignId, approvedText } = input;
  if (!campaignId) return { ok: false, error: "campaignId required." };
  if (!approvedText?.trim())
    return { ok: false, error: "Paste the approval reply text first." };

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { ok: false, error: "OPENROUTER_API_KEY not set." };

  const loaded = await loadTestReplies({ campaignId });
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const rows = loaded.rows.filter((r) => r.replyBody);
  if (rows.length === 0) {
    return { ok: false, error: "No inbound replies to dispatch against." };
  }

  // Build a compact index → firm/draft map so Opus can cross-reference
  // the approver's reply to the correct row.
  const indexed = rows.map((r, i) => ({
    index: i + 1,
    campaignPartnerId: r.campaignPartnerId,
    firmName: r.firmName,
    partnerName: r.partnerName,
    partnerEmail: r.partnerEmail,
    sentiment: r.cachedSentiment,
    draft: r.cachedDraftResponse,
    gmailThreadId: r.gmailThreadId,
    outboundSubject: r.outboundSubject,
  }));

  const system = [
    "You read a founder's free-form approval reply to a numbered response sheet and extract per-row decisions. Output ONLY a JSON array of objects, one per row you can identify in their reply, shape:",
    "  {\"index\": <1-based row number>, \"decision\": \"send\" | \"skip\" | \"edit\", \"edited_text\": \"<replacement response if decision=edit, else omit>\"}",
    "Rules:",
    "  - If a row number is mentioned with 'y', 'yes', 'ok', 'send', 'approved' → decision=send.",
    "  - If 'no', 'skip', 'not now', 'hold' → decision=skip.",
    "  - If the founder pasted a replacement paragraph or said 'use this instead' → decision=edit and edited_text = the replacement.",
    "  - If the founder acknowledged a row without decision → omit it (the caller treats omissions as 'hold').",
    "  - NEVER invent rows. NEVER guess decisions when the text is ambiguous — omit.",
    "  - British spelling.",
    "Output ONLY the JSON array, no prose, no markdown fence.",
  ].join("\n");

  const userPrompt = [
    "THE SHEET (numbered rows the founder was deciding on):",
    "---",
    indexed
      .map(
        (r) =>
          `${r.index}. ${r.firmName ?? "—"}${r.partnerName ? ` · ${r.partnerName}` : ""} [sentiment: ${r.sentiment ?? "unclassified"}]`,
      )
      .join("\n"),
    "---",
    "",
    "THE FOUNDER'S REPLY (parse this for decisions):",
    "---",
    approvedText.trim().slice(0, 20_000),
    "---",
  ].join("\n");

  let decisions: Array<{
    index: number;
    decision: "send" | "skip" | "edit";
    edited_text?: string;
  }>;
  try {
    const raw = await callOpenRouter({
      model: DISPATCH_PARSE_MODEL,
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
    decisions = JSON.parse(cleaned) as typeof decisions;
    if (!Array.isArray(decisions)) {
      return { ok: false, error: "Model parser did not return an array." };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Model parse failed: ${msg}` };
  }

  const outcomes: DispatchRowOutcome[] = [];

  for (const dec of decisions) {
    const row = indexed.find((r) => r.index === dec.index);
    if (!row) continue;

    if (dec.decision === "skip") {
      outcomes.push({
        campaignPartnerId: row.campaignPartnerId,
        firmName: row.firmName,
        decision: "skip",
        ok: true,
        detail: "Skipped per approver.",
      });
      continue;
    }

    const body =
      dec.decision === "edit" && dec.edited_text ? dec.edited_text : row.draft;
    if (!body) {
      outcomes.push({
        campaignPartnerId: row.campaignPartnerId,
        firmName: row.firmName,
        decision: dec.decision,
        ok: false,
        detail: "No response text available to dispatch.",
      });
      continue;
    }
    if (!row.partnerEmail) {
      outcomes.push({
        campaignPartnerId: row.campaignPartnerId,
        firmName: row.firmName,
        decision: dec.decision,
        ok: false,
        detail: "No partner email on file.",
      });
      continue;
    }
    if (!row.sentiment) {
      outcomes.push({
        campaignPartnerId: row.campaignPartnerId,
        firmName: row.firmName,
        decision: dec.decision,
        ok: false,
        detail: "No sentiment classification cached — re-classify first.",
      });
      continue;
    }

    const outcome = await sendResponseAndUpdateStatus({
      campaignPartnerId: row.campaignPartnerId,
      toEmail: row.partnerEmail,
      subject: row.outboundSubject?.startsWith("[TEST]")
        ? `Re: ${row.outboundSubject}`
        : `Re: ${row.outboundSubject ?? "our outreach"}`,
      body,
      sentiment: row.sentiment,
      gmailThreadId: row.gmailThreadId,
    });

    outcomes.push({
      campaignPartnerId: row.campaignPartnerId,
      firmName: row.firmName,
      decision: dec.decision,
      ok: outcome.ok,
      detail: outcome.ok
        ? `Sent → ${outcome.newStatusCode}`
        : outcome.error,
    });
  }

  revalidatePath("/approval/test-replies");
  revalidatePath("/tracker");

  const sent = outcomes.filter((o) => o.ok && o.decision !== "skip").length;
  const skipped = outcomes.filter((o) => o.decision === "skip").length;
  const failed = outcomes.filter((o) => !o.ok).length;
  return { ok: true, sent, skipped, failed, rows: outcomes };
}

/* ============================================================ */

export async function sendResponseAndUpdateStatus(
  input: SendResponseInput,
): Promise<SendResponseResult> {
  const { campaignPartnerId, toEmail, subject, body, sentiment, gmailThreadId } =
    input;
  if (!campaignPartnerId) return { ok: false, error: "campaignPartnerId required." };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Resolve the campaign so we can check counterpart_email. On a
  // self-managed campaign (no external company side) handover is
  // meaningless — reroute the row onto the positive branch so it
  // lands at +7 Meeting offered instead of +6.5.
  let selfManaged = false;
  {
    const { data: cpRow } = await supabase
      .from("campaign_partners")
      .select("campaign_id")
      .eq("id", campaignPartnerId)
      .maybeSingle();
    const campaignId = (cpRow as { campaign_id: string | null } | null)
      ?.campaign_id;
    if (campaignId) {
      const { data: campRow } = await supabase
        .from("campaigns")
        .select("counterpart_email, counterpart_name")
        .eq("id", campaignId)
        .maybeSingle();
      selfManaged = isSelfManaged(
        (campRow as {
          counterpart_email: string | null;
          counterpart_name: string | null;
        } | null) ?? null,
      );
    } else {
      // No campaign row found — treat as self-managed (permissive,
      // matches lib/queries/self-managed.ts isSelfManaged default).
      selfManaged = true;
    }
  }

  let sent;
  try {
    sent = await sendGmailMessage({ to: toEmail, subject, body });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Gmail send failed: ${msg}` };
  }

  // Status transition per Rule 8. +6.5 is Tristan's terminal state on
  // multi-party campaigns (FishFrom) — once he hands over to the
  // company (Stephan/Andrew/Andreas), he stops driving the row.
  //
  // Self-managed campaigns (SkySails, Panatere, ForgeOS, Fischer Farms
  // Customer) have no company side: handover rides the positive branch
  // to +7 so warm replies get calendar slots instead of a dead-end.
  const effectiveSentiment: Sentiment =
    selfManaged && sentiment === "handover" ? "positive" : sentiment;
  const newStatusCode =
    effectiveSentiment === "positive"
      ? "+7"
      : effectiveSentiment === "negative"
        ? "-1"
        : effectiveSentiment === "handover"
          ? "+6.5"
          : "+5";
  const newStatusLabel =
    effectiveSentiment === "positive"
      ? "Meeting offered"
      : effectiveSentiment === "negative"
        ? "Declined"
        : effectiveSentiment === "handover"
          ? "Handover to company"
          : "Follow-up sent";

  // Defensive guard: never write a status_code that isn't in the
  // canonical legend. This catches the 2026-04-23 class of bug where
  // "+6.5" was dispatched but missing from lib/status-codes.ts, so
  // labelFor() returned null and the tracker drawer couldn't render it.
  const registered = STATUS_BY_CODE[newStatusCode];
  if (!registered) {
    throw new Error(
      `status_code "${newStatusCode}" (sentiment=${effectiveSentiment}) is not in STATUS_CODES — add it to lib/status-codes.ts before dispatching.`,
    );
  }
  if (registered.label !== newStatusLabel) {
    throw new Error(
      `status_code "${newStatusCode}" label mismatch: dispatcher wrote "${newStatusLabel}" but registry says "${registered.label}".`,
    );
  }

  await supabase
    .from("campaign_partners")
    .update({
      status_code: newStatusCode,
      status_label: newStatusLabel,
      last_contact_at: new Date().toISOString(),
    })
    .eq("id", campaignPartnerId);

  // Log contact events — one for the inbound reply, one for the outbound
  // response. These feed the weekly chart and the partner timeline.
  await supabase.from("contact_events").insert([
    {
      campaign_partner_id: campaignPartnerId,
      event_type: `inbound_reply_${effectiveSentiment}`,
      event_at: new Date().toISOString(),
      direction: "inbound",
      channel: "gmail",
      gmail_thread_id: gmailThreadId,
      summary: `[TEST REPLY] ${effectiveSentiment}`,
    },
    {
      campaign_partner_id: campaignPartnerId,
      event_type: "test_response_sent",
      event_at: new Date().toISOString(),
      direction: "outbound",
      channel: "gmail",
      gmail_thread_id: sent.threadId,
      gmail_message_id: sent.id,
      summary: subject,
    },
  ]);

  revalidatePath("/approval/test-replies");
  revalidatePath("/tracker");
  return { ok: true, threadId: sent.threadId, newStatusCode };
}
