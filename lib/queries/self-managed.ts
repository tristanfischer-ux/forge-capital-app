/**
 * Self-managed campaign detection + copy helpers.
 *
 * Tristan 2026-04-23: "When I do the Fischer Farms outreach programme,
 * I am going to be the user and the customer, and so I'm not going to
 * be sending or asking for authorisation to other people for this."
 *
 * A "self-managed" campaign is one where there's no external approver
 * or counterpart to hand over to. Tristan is both the sender AND the
 * person who signs off the list AND the person who takes warm replies.
 * Currently four of six campaigns in the DB are self-managed (SkySails,
 * Panatere, ForgeOS, Fischer Farms Customer) — FishFrom is the lone
 * multi-party one (counterpart: Andrew Robertson at FishFrom).
 *
 * This file is the single source of truth for how the UI adapts its
 * copy + status-code vocabulary in the self-managed case.
 */

/**
 * Minimal shape we read — any campaign-like object with the
 * counterpart_email column from migration 012 satisfies this.
 */
export interface CampaignSelfManagedInput {
  counterpart_email: string | null;
  counterpart_name?: string | null;
}

/**
 * True when there's no external counterpart configured for this
 * campaign. Checked at render time — no migration / column needed.
 *
 * Kept deliberately permissive: empty strings and whitespace-only
 * values count as "unset" so a half-filled counterpart row doesn't
 * accidentally drop the campaign back into the multi-party flow.
 */
export function isSelfManaged(campaign: CampaignSelfManagedInput | null | undefined): boolean {
  if (!campaign) return true;
  const email = (campaign.counterpart_email ?? "").trim();
  return email.length === 0;
}

/**
 * Label to use where the counterpart would otherwise be named.
 * Single-party campaigns read cleaner with "your review" than the
 * placeholder "Counterpart TBD" they get today.
 */
export function counterpartDisplayName(
  campaign: CampaignSelfManagedInput | null | undefined,
): string {
  if (isSelfManaged(campaign)) return "you";
  return (campaign?.counterpart_name ?? "").trim() || "Counterpart TBD";
}

/**
 * Approval-page possessive — "{counterpart}'s reply" / "your reply".
 */
export function counterpartPossessive(
  campaign: CampaignSelfManagedInput | null | undefined,
): string {
  if (isSelfManaged(campaign)) return "your";
  const name = (campaign?.counterpart_name ?? "").trim();
  return name ? `${name}'s` : "the counterpart's";
}

/**
 * For the Opus reply classifier in /approval/test-replies: the
 * `handover` bucket means "pass this dialogue to the company side".
 * In a self-managed campaign there IS no company side — the warm
 * reply stays with the founder. Treat `handover` as `positive` so
 * the response drafter offers calendar slots instead of a handover
 * message nobody receives.
 *
 * Usage inside the reply dispatcher:
 *
 *   const effective = isSelfManaged(campaign) && sentiment === 'handover'
 *     ? 'positive'
 *     : sentiment;
 */
export function effectiveSentimentForSelfManaged<
  T extends "positive" | "negative" | "neutral" | "handover",
>(
  sentiment: T,
  campaign: CampaignSelfManagedInput | null | undefined,
): "positive" | "negative" | "neutral" {
  if (sentiment === "handover") {
    return isSelfManaged(campaign) ? "positive" : "positive";
    // Note: the above looks redundant but is intentional — handover is
    // treated as positive for dispatch-status purposes on BOTH paths;
    // the difference is only in response-drafting voice (own-send vs.
    // handover-to-company), which is applied upstream in the prompt.
  }
  return sentiment;
}

/**
 * The +6.5 Handover status is meaningless on self-managed campaigns —
 * there's no company side to hand over to. Keep it in the taxonomy
 * for multi-party campaigns but hide it from status pickers on
 * self-managed ones.
 */
export function statusCodesVisibleFor(
  campaign: CampaignSelfManagedInput | null | undefined,
): (code: string) => boolean {
  const selfManaged = isSelfManaged(campaign);
  return (code) => !(selfManaged && code === "+6.5");
}
