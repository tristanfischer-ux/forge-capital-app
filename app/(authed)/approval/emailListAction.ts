"use server";

import { sendGmailMessage } from "@/lib/gmail/create-draft";
import { getPendingApproval, getApprovalCampaignMeta } from "@/lib/queries/approval";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Email the outgoing approval sheet as a plain-text list to a review
 * address. Used when the founder is away from their desk and wants
 * to approve / reject rows from a phone — they reply to the email
 * with per-row markers the /approval Step 2 parser understands.
 */

export interface EmailListInput {
  campaignId: string;
  toEmail: string;
}

export type EmailListResult =
  | { ok: true; threadId: string }
  | { ok: false; error: string };

export async function emailApprovalListToAddress(
  input: EmailListInput,
): Promise<EmailListResult> {
  const { campaignId, toEmail } = input;
  if (!campaignId) return { ok: false, error: "campaignId required." };
  if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return { ok: false, error: "Invalid toEmail." };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const [meta, rows] = await Promise.all([
    getApprovalCampaignMeta(campaignId),
    getPendingApproval(campaignId),
  ]);
  if (!meta) return { ok: false, error: "Campaign not found." };
  if (rows.length === 0) {
    return { ok: false, error: "No +0 Pending approval rows to send." };
  }

  const today = new Date().toISOString().slice(0, 10);
  const subject = `[APPROVAL] ${meta.campaign_name ?? "Campaign"} — ${rows.length} investors for review · ${today}`;

  const lines: string[] = [];
  lines.push(
    `Hi,`,
    ``,
    `Below are the ${rows.length} investors the pipeline has surfaced for ${meta.campaign_name ?? "the campaign"} as of ${today}.`,
    ``,
    `For each row, reply with one of:`,
    `  ok     — approve, proceed to draft`,
    `  no     — not a fit, archive`,
    `  flag   — needs a look, ping me`,
    `  skip   — skip this round, keep in pool`,
    ``,
    `The reply parser on /approval (Step 2) reads your annotations and reconciles each row into the tracker.`,
    ``,
    `— Tristan`,
    ``,
    `-----------------`,
    ``,
  );

  rows.forEach((r, i) => {
    const contact = [r.partner_name, r.partner_title, r.hq_location]
      .filter(Boolean)
      .join(" · ");
    const why =
      r.why_them && r.why_them.length > 0
        ? r.why_them
        : "— synthesis pending —";
    lines.push(`${i + 1}. ${r.firm_name ?? "—"}`);
    if (contact) lines.push(`   ${contact}`);
    lines.push(``);
    lines.push(`   Why them: ${why}`);
    lines.push(``);
    lines.push(`   ___ ok / no / flag / skip`);
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
    return { ok: true, threadId: sent.threadId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Gmail send failed: ${msg}` };
  }
}
