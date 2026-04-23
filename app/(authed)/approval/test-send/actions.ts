"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { createServerClient } from "@/lib/supabase/server";
import {
  getInvestorModalData,
  type InvestorModalData,
} from "@/lib/queries/investorModal";
import {
  composeDraft,
  type ComposedDraft,
} from "@/app/(authed)/tracker/[campaignPartnerId]/draft/compose";
import { sendGmailMessage } from "@/lib/gmail/create-draft";
import { refineSynthesisWithOpus } from "@/app/(authed)/tracker/[campaignPartnerId]/draft/refineSynthesisAction";

/**
 * Server action: dispatch a batch of test-drafts to a review inbox.
 *
 * Picks the first `maxCount` pending-approval rows for the campaign,
 * runs each through the shared composer, and sends each to `toEmail`
 * with a `[TEST]` subject prefix + trailing test banner.
 *
 * The live tracker row status is NOT advanced — we only log a
 * `contact_events` row with kind `test_send` so the campaign's real
 * pipeline (+0 → +2 Drafted → +3 Email sent) stays untouched.
 *
 * Returns a summary per-row so the UI can show which firms succeeded
 * and which failed (and why).
 *
 * Per Outreach Drafting Runbook §11/§12/§13, per-row pre-send and
 * post-generation checks block risky dispatches WITHOUT aborting the
 * batch. Each skip is surfaced in the outcome list so the founder can
 * see which rows need research before a re-dispatch.
 */

export interface SendTestBatchInput {
  campaignId: string;
  toEmail: string;
  maxCount: number;
}

export interface PerRowOutcome {
  campaignPartnerId: string;
  firmName: string | null;
  partnerName: string | null;
  ok: boolean;
  /** On success: Gmail thread URL; on failure: error text. */
  detail: string;
}

export type SendTestBatchResult =
  | {
      ok: true;
      sent: number;
      failed: number;
      rows: PerRowOutcome[];
    }
  | { ok: false; error: string };

const TEST_BATCH_TAG = "[TEST]";

const FISHFROM_VIDEO_URL =
  "https://drive.google.com/file/d/1NaBR14yfBOzrS9GiauCRYDEYs6JpBh7O/view";

const RULE1_HEDGE_REGEX =
  /(My understanding is that|From what I have read|As I understand it|I understand that|If I have read this right|From what I can gather)/i;

const FLATTERY_REGEX =
  /(congratulations|great to see|loved your|enjoyed your|impressive work|excited to see)\b/i;

const BARE_RANK_SALUTATION_REGEX =
  /^Dear (Admiral|Ambassador|Captain|General|Colonel|Commander|Lieutenant|Major|Senator|Governor|Commodore),\s*$/mi;

/**
 * Post-generation rule-compliance lint per Runbook §12. Checks the
 * composed body and subject against every hard rule Tristan has
 * codified. Returns `{pass, failures}` — on fail, the batch dispatcher
 * skips the row with a bulleted list in the outcome detail.
 *
 * The lint is cheap (all regex / substring) and runs PER ROW AFTER
 * composeDraft() but BEFORE Gmail send, so malformed drafts never hit
 * the test inbox.
 */
function ruleComplianceLint(
  subject: string,
  body: string,
  campaignName: string,
): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  const campaignLower = campaignName.toLowerCase();
  const isFishFrom = campaignLower.includes("fishfrom");
  const isSkySails = campaignLower.includes("skysails");

  // Rule: Drax never appears (verboten reference) — body OR subject.
  if (/drax/i.test(body) || /drax/i.test(subject)) {
    failures.push("body or subject contains 'Drax' (banned reference)");
  }

  // Rule 3: credibility paragraph mentions "twenty-five years".
  if (!body.includes("twenty-five years")) {
    failures.push("body missing 'twenty-five years' credibility phrase");
  }

  // Rule 12: sign-off includes LinkedIn URL verbatim.
  if (!body.includes("https://www.linkedin.com/in/tristanfischer/")) {
    failures.push("body missing LinkedIn URL in sign-off");
  }

  // Rule 1: at least one hedge phrase in the synthesis.
  if (!RULE1_HEDGE_REGEX.test(body)) {
    failures.push("body missing Rule 1 hedge phrase");
  }

  // Rule 7: CTA asks for 20 or 30 minutes.
  const has20 = /20 minutes/i.test(body);
  const has30Slots = body.includes("30-minute slots");
  const has30 = /30 minutes/i.test(body);
  if (!has20 && !has30Slots && !has30) {
    failures.push("body missing 20-minute / 30-minute CTA ask");
  }

  // Rule 9: no flattery tokens.
  if (FLATTERY_REGEX.test(body)) {
    failures.push("body contains flattery token (Rule 9)");
  }

  // Runbook §5 Rule 10: no bare-rank salutation.
  if (BARE_RANK_SALUTATION_REGEX.test(body)) {
    failures.push("body has bare-rank salutation (needs surname)");
  }

  // Rule 5: FishFrom video URL iff FishFrom campaign.
  const hasFishFromUrl = body.includes(FISHFROM_VIDEO_URL);
  if (isFishFrom && !hasFishFromUrl) {
    failures.push("FishFrom campaign missing Andrew Robertson video URL");
  }
  if (!isFishFrom && hasFishFromUrl) {
    failures.push(
      "non-FishFrom campaign contains FishFrom video URL (cross-contamination)",
    );
  }

  // SkySails-specific: Kembara precedent + "€5M Series A bridge" must
  // both appear so the specific-enough framing survives.
  if (isSkySails) {
    if (!body.includes("Kembara")) {
      failures.push("SkySails campaign missing 'Kembara' precedent");
    }
    if (!body.includes("€5M Series A bridge")) {
      failures.push("SkySails campaign missing '€5M Series A bridge' framing");
    }
  }

  return { pass: failures.length === 0, failures };
}

/**
 * Shared pending-row reader — used by both sendTestBatch and
 * exportBatchToXlsx so the two surfaces operate on the same data set.
 */
async function listPendingPartnerIds(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  campaignId: string,
  capped: number,
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const { data: pending, error: pendingErr } = await supabase
    .from("campaign_partners")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("status_code", "+0")
    .order("created_at", { ascending: true })
    .limit(capped + 10);

  if (pendingErr) {
    return {
      ok: false,
      error: `Pending-rows read failed: ${pendingErr.message}`,
    };
  }
  return { ok: true, ids: (pending ?? []).map((r) => r.id as string) };
}

/**
 * Check #1 of Runbook §11: any prior REAL first-contact outbound event
 * against this partner on any campaign. Test-batch sends (event_type =
 * test_send) do NOT count — the whole point of the test batch is to
 * allow re-dispatch over previous test sends.
 *
 * Returns a skip reason if a prior real send exists, else null.
 */
async function checkPriorFirstContact(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  campaignPartnerId: string,
): Promise<string | null> {
  const { data: events, error } = await supabase
    .from("contact_events")
    .select("event_at, event_type, gmail_thread_id")
    .eq("campaign_partner_id", campaignPartnerId)
    .eq("direction", "outbound")
    .neq("event_type", "test_send")
    .order("event_at", { ascending: true })
    .limit(1);

  if (error) {
    // Fail open — a read failure should not block the batch; surface
    // the failure so the founder can investigate.
    return `contact_events read failed: ${error.message}`;
  }

  const first = (events ?? [])[0];
  if (!first) return null;

  const firstAt = first.event_at ? new Date(first.event_at).getTime() : 0;
  const daysAgo =
    firstAt > 0
      ? Math.max(0, Math.floor((Date.now() - firstAt) / 86_400_000))
      : null;
  const thread = first.gmail_thread_id ?? "(no thread id)";
  const ago = daysAgo === null ? "unknown days ago" : `${daysAgo}d ago`;
  return `Skipped — prior first-contact sent ${ago} on ${thread}`;
}

/**
 * Check #2 of Runbook §11: the same partner is at +6.5 Handover or -2
 * Bounced on another campaign. Mirrors the Find-a-Match conflict banner
 * logic — batch-time enforcement so a parallel campaign's handover is
 * never stomped on.
 *
 * Needs the partner_id on the current campaign_partners row to join
 * cross-campaign.
 */
async function checkCrossWorkstream(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  campaignPartnerId: string,
  currentCampaignId: string,
): Promise<string | null> {
  // 1. Resolve current row → partner_id.
  const { data: currentRow, error: currentErr } = await supabase
    .from("campaign_partners")
    .select("partner_id")
    .eq("id", campaignPartnerId)
    .maybeSingle();
  if (currentErr || !currentRow?.partner_id) {
    return null; // nothing to cross-check against; fail open.
  }

  // 2. Other rows with same partner_id on different campaign in
  //    +6.5 / -2 status.
  const { data: otherRows, error: otherErr } = await supabase
    .from("campaign_partners")
    .select(
      `
      id,
      status_code,
      campaign_id,
      campaigns:campaign_id (
        name
      )
      `,
    )
    .eq("partner_id", currentRow.partner_id)
    .neq("campaign_id", currentCampaignId)
    .in("status_code", ["+6.5", "-2"]);
  if (otherErr || !otherRows || otherRows.length === 0) return null;

  // Prefer +6.5 Handover over -2 Bounced for the skip reason (the
  // handover signal is more urgent — real deal in flight).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = otherRows as any[];
  const handover = rows.find((r) => r.status_code === "+6.5");
  if (handover) {
    const otherName =
      (handover.campaigns?.name as string | null) ?? "another campaign";
    return `Skipped — partner at +6.5 Handover on ${otherName}`;
  }
  const bounced = rows.find((r) => r.status_code === "-2");
  if (bounced) {
    const otherName =
      (bounced.campaigns?.name as string | null) ?? "another campaign";
    return `Skipped — partner bounced on ${otherName}`;
  }
  return null;
}

/**
 * Ensure the row has a rendered_synthesis + subject_angle; if not, run
 * the Opus refine. Returns the loaded data on success, or a skip
 * reason on failure. Shared between send + xlsx export so both flows
 * show identical bodies.
 */
async function loadOrRefineRow(
  partnerId: string,
): Promise<
  | { ok: true; data: InvestorModalData }
  | { ok: false; skipReason: string }
> {
  let data = await getInvestorModalData(partnerId);
  if (!data) {
    return { ok: false, skipReason: "getInvestorModalData returned null" };
  }
  if (data.rendered_synthesis && data.subject_angle) {
    return { ok: true, data };
  }
  const refined = await refineSynthesisWithOpus({
    campaignPartnerId: partnerId,
  });
  if (!refined.ok) {
    return {
      ok: false,
      skipReason: `Skipped — synthesis could not be generated: ${refined.error}`,
    };
  }
  data = await getInvestorModalData(partnerId);
  if (!data) {
    return { ok: false, skipReason: "reload after refine returned null" };
  }
  return { ok: true, data };
}

export async function sendTestBatch(
  input: SendTestBatchInput,
): Promise<SendTestBatchResult> {
  const { campaignId, toEmail, maxCount } = input;
  if (!campaignId) return { ok: false, error: "campaignId is required." };
  if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return { ok: false, error: "toEmail must be a valid email address." };
  }
  const capped = Math.max(1, Math.min(50, Math.floor(maxCount)));

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Resolve campaign name once for the rule-compliance lint (FishFrom /
  // SkySails branch on the name).
  const { data: campaignRow } = await supabase
    .from("campaigns")
    .select("name")
    .eq("id", campaignId)
    .maybeSingle();
  const campaignName = (campaignRow?.name as string | null) ?? "";

  const pendingResult = await listPendingPartnerIds(
    supabase,
    campaignId,
    capped,
  );
  if (!pendingResult.ok) {
    return { ok: false, error: pendingResult.error };
  }
  const pendingIds = pendingResult.ids;
  if (pendingIds.length === 0) {
    return {
      ok: false,
      error: "No +0 Pending approval rows on this campaign — shortlist first.",
    };
  }

  const outcomes: PerRowOutcome[] = [];
  // Track subjects already queued in this batch so a later duplicate
  // can be skipped (Runbook §12 uniqueness check).
  const sentSubjectsInBatch = new Set<string>();

  for (const partnerId of pendingIds) {
    if (outcomes.filter((o) => o.ok).length >= capped) break;

    // -------- Pre-send check 1: prior first-contact on this row --------
    const priorReason = await checkPriorFirstContact(supabase, partnerId);
    if (priorReason) {
      // We don't have firm/partner names yet — hydrate once for a nicer
      // outcome list entry.
      const peek = await getInvestorModalData(partnerId);
      outcomes.push({
        campaignPartnerId: partnerId,
        firmName: peek?.investor.firm_name ?? null,
        partnerName: peek?.primary_partner?.name ?? null,
        ok: false,
        detail: priorReason,
      });
      continue;
    }

    // -------- Pre-send check 2: cross-workstream conflict --------
    const crossReason = await checkCrossWorkstream(
      supabase,
      partnerId,
      campaignId,
    );
    if (crossReason) {
      const peek = await getInvestorModalData(partnerId);
      outcomes.push({
        campaignPartnerId: partnerId,
        firmName: peek?.investor.firm_name ?? null,
        partnerName: peek?.primary_partner?.name ?? null,
        ok: false,
        detail: crossReason,
      });
      continue;
    }

    // Step 1: load partner data (with refine if needed).
    const loaded = await loadOrRefineRow(partnerId);
    if (!loaded.ok) {
      const peek = await getInvestorModalData(partnerId);
      outcomes.push({
        campaignPartnerId: partnerId,
        firmName: peek?.investor.firm_name ?? null,
        partnerName: peek?.primary_partner?.name ?? null,
        ok: false,
        detail: loaded.skipReason,
      });
      continue;
    }
    const data = loaded.data;

    const firmName = data.investor.firm_name ?? "Unknown firm";
    const partnerName = data.primary_partner?.name ?? null;

    const draft = composeDraft(data);

    const subject = `${TEST_BATCH_TAG} ${draft.subject}`.slice(0, 240);
    // Use the composer's fullBody — salutation + paragraphs + sign-off.
    // Previously sent just `bodyParagraphs.join`, which dropped both the
    // "Dear <Name>," greeting and the "Best regards, Tristan Fischer..."
    // sign-off. Tristan flagged this 2026-04-23 on batch #2.
    const body = [
      draft.fullBody,
      "",
      "— TEST —",
      "This is a TEST dispatch to a review inbox. No real investor received this message. Reply with 'ok / not for me / skip' style markers to simulate an approver response.",
    ].join("\n\n");

    // -------- Post-generation lint (Runbook §12) --------
    const lint = ruleComplianceLint(draft.subject, draft.fullBody, campaignName);
    if (!lint.pass) {
      outcomes.push({
        campaignPartnerId: partnerId,
        firmName,
        partnerName,
        ok: false,
        detail: `Skipped — lint failures: ${lint.failures.map((f) => `• ${f}`).join(" ")}`,
      });
      continue;
    }

    // -------- Within-batch subject uniqueness --------
    const normalisedSubject = draft.subject.trim().toLowerCase();
    if (sentSubjectsInBatch.has(normalisedSubject)) {
      outcomes.push({
        campaignPartnerId: partnerId,
        firmName,
        partnerName,
        ok: false,
        detail:
          "Skipped — duplicate subject already sent to another row in this batch",
      });
      continue;
    }

    try {
      const sent = await sendGmailMessage({
        to: toEmail,
        subject,
        body,
      });

      // Mark subject taken ONLY after a successful dispatch so a send
      // failure doesn't block a retry on a different row.
      sentSubjectsInBatch.add(normalisedSubject);

      // Log to contact_events with event_type = test_send so the tracker
      // distinguishes dry runs from real sends. Real schema uses
      // event_type/event_at/summary/channel (not kind/occurred_at/subject).
      await supabase.from("contact_events").insert({
        campaign_partner_id: partnerId,
        event_type: "test_send",
        event_at: new Date().toISOString(),
        direction: "outbound",
        channel: "gmail",
        gmail_thread_id: sent.threadId,
        gmail_message_id: sent.id,
        summary: subject,
      });

      outcomes.push({
        campaignPartnerId: partnerId,
        firmName,
        partnerName,
        ok: true,
        detail: `https://mail.google.com/mail/u/0/#sent/${sent.threadId}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outcomes.push({
        campaignPartnerId: partnerId,
        firmName,
        partnerName,
        ok: false,
        detail: msg,
      });
    }
  }

  revalidatePath("/approval/test-send");
  revalidatePath("/approval");
  revalidatePath("/tracker");

  const sentCount = outcomes.filter((o) => o.ok).length;
  const failedCount = outcomes.length - sentCount;
  return {
    ok: true,
    sent: sentCount,
    failed: failedCount,
    rows: outcomes,
  };
}

// ---------------------------------------------------------------------
// Excel export (Runbook §13)
// ---------------------------------------------------------------------

export type ExportBatchResult =
  | { ok: true; base64: string; filename: string }
  | { ok: false; error: string };

/**
 * Build a workstream-slug for the xlsx filename (YYMMDD <slug>.xlsx).
 */
function slugifyCampaignName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9\s_-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 40);
  return cleaned || "drafts";
}

function yymmdd(d = new Date()): string {
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

/**
 * Produce an xlsx workbook of the current pending-approval drafts for
 * a campaign — same row set as sendTestBatch would pick, composed with
 * the same composer, linted with the same rule-compliance lint. The
 * xlsx is returned as base64 so the client can decode + download via a
 * Blob URL.
 *
 * Two sheets:
 *   - "Drafts": one row per pending partner with Subject + Body + Note
 *     (lint failures appear in Note; rest of the row is untouched).
 *   - "Summary": totals + skip-reason breakdown.
 *
 * This is a dry-run surface — no emails are sent, no contact_events
 * are logged. Pure read + compose + pack.
 */
export async function exportBatchToXlsx(input: {
  campaignId: string;
}): Promise<ExportBatchResult> {
  const { campaignId } = input;
  if (!campaignId) return { ok: false, error: "campaignId is required." };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: campaignRow } = await supabase
    .from("campaigns")
    .select("name")
    .eq("id", campaignId)
    .maybeSingle();
  const campaignName = (campaignRow?.name as string | null) ?? "Campaign";

  // Use the same capped-50 rule as sendTestBatch for consistency.
  const capped = 50;
  const pendingResult = await listPendingPartnerIds(
    supabase,
    campaignId,
    capped,
  );
  if (!pendingResult.ok) {
    return { ok: false, error: pendingResult.error };
  }
  if (pendingResult.ids.length === 0) {
    return {
      ok: false,
      error: "No +0 Pending approval rows on this campaign — shortlist first.",
    };
  }

  interface DraftRow {
    index: number;
    workstream: string;
    firm: string;
    tier: string;
    confidence: string;
    recipient: string;
    email: string;
    subject: string;
    body: string;
    trackerRow: string;
    note: string;
  }

  const rows: DraftRow[] = [];
  const skipReasons = new Map<string, number>();
  let passCount = 0;

  // Track within-export subject uniqueness the same way the send flow
  // does so the xlsx's "Note" column flags the later duplicate.
  const exportSubjectsSeen = new Set<string>();

  let index = 1;
  for (const partnerId of pendingResult.ids.slice(0, capped)) {
    const loaded = await loadOrRefineRow(partnerId);
    if (!loaded.ok) {
      const peek = await getInvestorModalData(partnerId);
      rows.push({
        index: index++,
        workstream: campaignName,
        firm: peek?.investor.firm_name ?? "—",
        tier: peek?.primary_partner?.email_tier ?? "",
        confidence: "",
        recipient: peek?.primary_partner?.name ?? "",
        email: peek?.primary_partner?.email ?? "",
        subject: "",
        body: "",
        trackerRow: partnerId,
        note: loaded.skipReason,
      });
      skipReasons.set(
        "synthesis-or-load",
        (skipReasons.get("synthesis-or-load") ?? 0) + 1,
      );
      continue;
    }
    const data = loaded.data;
    let draft: ComposedDraft;
    try {
      draft = composeDraft(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      rows.push({
        index: index++,
        workstream: campaignName,
        firm: data.investor.firm_name ?? "—",
        tier: data.primary_partner?.email_tier ?? "",
        confidence: "",
        recipient: data.primary_partner?.name ?? "",
        email: data.primary_partner?.email ?? "",
        subject: "",
        body: "",
        trackerRow: partnerId,
        note: `compose failed: ${msg}`,
      });
      skipReasons.set("compose-failed", (skipReasons.get("compose-failed") ?? 0) + 1);
      continue;
    }

    const lint = ruleComplianceLint(draft.subject, draft.fullBody, campaignName);
    let note = "";
    const normalised = draft.subject.trim().toLowerCase();
    const duplicate = exportSubjectsSeen.has(normalised);
    if (duplicate) {
      note = "Skipped — duplicate subject already sent to another row in this batch";
      skipReasons.set(
        "duplicate-subject",
        (skipReasons.get("duplicate-subject") ?? 0) + 1,
      );
    } else if (!lint.pass) {
      note = `Lint failures: ${lint.failures.map((f) => `• ${f}`).join(" ")}`;
      skipReasons.set("lint", (skipReasons.get("lint") ?? 0) + 1);
    } else {
      passCount += 1;
      exportSubjectsSeen.add(normalised);
    }

    rows.push({
      index: index++,
      workstream: campaignName,
      firm: data.investor.firm_name ?? "—",
      tier: data.primary_partner?.email_tier ?? "",
      confidence: "",
      recipient: data.primary_partner?.name ?? "",
      email: data.primary_partner?.email ?? "",
      subject: draft.subject,
      body: draft.fullBody,
      trackerRow: partnerId,
      note,
    });
  }

  // Build the workbook.
  const draftsAoa: (string | number)[][] = [
    [
      "#",
      "Workstream",
      "Firm",
      "Tier",
      "Confidence",
      "Recipient",
      "Email",
      "Subject",
      "Body",
      "Tracker row",
      "Note",
    ],
    ...rows.map((r) => [
      r.index,
      r.workstream,
      r.firm,
      r.tier,
      r.confidence,
      r.recipient,
      r.email,
      r.subject,
      r.body,
      r.trackerRow,
      r.note,
    ]),
  ];
  const draftsSheet = XLSX.utils.aoa_to_sheet(draftsAoa);
  // Approximate column widths for legibility in Excel / Numbers.
  draftsSheet["!cols"] = [
    { wch: 4 }, // #
    { wch: 24 }, // Workstream
    { wch: 28 }, // Firm
    { wch: 10 }, // Tier
    { wch: 10 }, // Confidence
    { wch: 24 }, // Recipient
    { wch: 30 }, // Email
    { wch: 48 }, // Subject
    { wch: 80 }, // Body
    { wch: 12 }, // Tracker row
    { wch: 40 }, // Note
  ];

  const summaryAoa: (string | number)[][] = [
    ["Metric", "Value"],
    ["Total rows", rows.length],
    ["Passed lint", passCount],
    ["Skipped — duplicate subject", skipReasons.get("duplicate-subject") ?? 0],
    ["Skipped — lint failure", skipReasons.get("lint") ?? 0],
    ["Skipped — compose failed", skipReasons.get("compose-failed") ?? 0],
    [
      "Skipped — synthesis/load failed",
      skipReasons.get("synthesis-or-load") ?? 0,
    ],
    ["Campaign", campaignName],
    ["Generated (UTC)", new Date().toISOString()],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryAoa);
  summarySheet["!cols"] = [{ wch: 40 }, { wch: 40 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, draftsSheet, "Drafts");
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

  // Write to a base64 buffer — the client decodes into a Blob.
  const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;
  const filename = `${yymmdd()} ${slugifyCampaignName(campaignName)}.xlsx`;
  return { ok: true, base64: b64, filename };
}
