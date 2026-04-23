"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getGmailThread } from "@/lib/gmail/read-thread";
import { sendGmailMessage } from "@/lib/gmail/create-draft";
import { getInvestorModalData } from "@/lib/queries/investorModal";

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

const OPUS_MODEL = "claude-opus-4-7";

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
  cachedSentiment: "positive" | "negative" | "neutral" | null;
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
export type Sentiment = "positive" | "negative" | "neutral";

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY not set." };

  const data = await getInvestorModalData(campaignPartnerId);
  if (!data) return { ok: false, error: "Partner not found." };

  const firmName = data.investor.firm_name ?? "the firm";
  const firstName =
    (data.primary_partner?.name ?? "").trim().split(/\s+/)[0] || "there";
  const founderBio = data.campaign?.company_description ?? "";

  const system = [
    "You are a senior fundraising-operations analyst supporting Tristan Fischer. You read an investor's reply to a cold outreach email and do TWO things:",
    "  1. Classify sentiment as 'positive' | 'negative' | 'neutral'. Use these definitions:",
    "     - positive: expresses any interest — 'happy to meet', 'interested', 'send me the deck', 'book a call', even cautious interest like 'we could look at this'.",
    "     - negative: explicit no — 'not for us', 'out of thesis', 'we pass', 'unfortunately no', or an obvious decline.",
    "     - neutral: neither — asks a question, redirects to a colleague, says 'now is not the right time but maybe later', or anything ambiguous.",
    "  2. Draft a short response Tristan can send back: 2-4 sentences, same first-person British voice he uses in first-contacts. NEVER flatter ('congratulations', 'great to see', etc.). If positive: thank briefly, propose 3 specific 30-minute slots over the next 10 working days in BST, offer to send the deck ahead. If negative: thank, acknowledge, leave the door open for future, do not argue. If neutral: answer any question if one was asked, otherwise gently probe for more info.",
    "Output ONLY a JSON object: {\"sentiment\": \"<bucket>\", \"reasons\": [\"<short bullet>\", ...], \"draft_response\": \"<paragraph>\"} — no prose, no markdown fence. British spelling. Never invent facts outside the provided context. NO bracketed placeholders like [X] / [name].",
  ].join("\n");

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
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: OPUS_MODEL,
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
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
      return { ok: false, error: `Opus returned non-JSON (${msg}). Raw: ${raw.slice(0, 160)}` };
    }

    const sentiment =
      parsed.sentiment === "positive" ||
      parsed.sentiment === "negative" ||
      parsed.sentiment === "neutral"
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

    // Cache sentiment + draft on the campaign_partners row so the UI can
    // reload without re-hitting Opus.
    const supabase = await createServerClient();
    await supabase
      .from("campaign_partners")
      .update({
        reply_sentiment: sentiment,
        drafted_response: draftResponse,
      })
      .eq("id", campaignPartnerId);

    return { ok: true, sentiment, reasons, draftResponse };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Opus call failed: ${msg}` };
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

  let sent;
  try {
    sent = await sendGmailMessage({ to: toEmail, subject, body });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Gmail send failed: ${msg}` };
  }

  // Status transition.
  const newStatusCode =
    sentiment === "positive"
      ? "+7"
      : sentiment === "negative"
        ? "-1"
        : "+5";
  const newStatusLabel =
    sentiment === "positive"
      ? "Meeting offered"
      : sentiment === "negative"
        ? "Declined"
        : "Follow-up sent";

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
      event_type: `inbound_reply_${sentiment}`,
      event_at: new Date().toISOString(),
      direction: "inbound",
      channel: "gmail",
      gmail_thread_id: gmailThreadId,
      summary: `[TEST REPLY] ${sentiment}`,
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
