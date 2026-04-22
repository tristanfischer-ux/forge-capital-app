import Link from "next/link";
import { cookies } from "next/headers";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
  type CampaignSummary,
} from "@/lib/queries/campaigns";
import { getDraftsReadyForReview } from "@/lib/queries/review";
import { ReviewStack } from "./ReviewStack";

/**
 * V4 §5 Eyeball review — bulk accept / edit / discard.
 *
 * 1:1 port of Phase2-Mockup-V4.html lines 1526-1647. DOM class names
 * come from app/v4-mockup.css (`.er-keymap`, `.er-stack`, `.er-draft`,
 * `.er-num`, `.er-to`, `.er-subj`, `.er-preview`, `.er-controls`,
 * `.er-kbd`, `.er-btns`, `.er-btn.ok|edit|discard`).
 *
 * Data: `campaign_partners` WHERE `status_code = '+2'` joined to the
 * firm + partner + email tier + campaign's latest email_templates row
 * for preview copy. The full draft renders at /tracker/<id>/draft.
 *
 * Keyboard shortcuts (handled in ReviewStack): J / K navigate, A or
 * Enter accept, E edit, D discard.
 *
 * Empty state is honest — the DB currently has no rows at +2, so the
 * page shows the explanatory empty card rather than fabricating drafts.
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ c?: string }>;

export default async function ReviewPage({
  searchParams,
  initialCampaigns,
  initialCampaignId,
}: {
  searchParams: SearchParams;
  /** Optional pre-fetched campaigns list (passed by /home composer to
   *  avoid re-running `listActiveCampaigns()` 7× per render). When
   *  omitted — e.g. direct navigation to /review — we fetch as before. */
  initialCampaigns?: CampaignSummary[];
  /** Optional pre-resolved active campaign id (same rationale). */
  initialCampaignId?: string | null;
}) {
  const { c } = await searchParams;

  // Campaign resolution matches the pattern used by the tracker page:
  // ?c=<uuid> wins, else fall back to the `fc_active_campaign` cookie set
  // by the top-bar switcher, else the first active campaign. Skipped when
  // the composer passes pre-fetched data.
  let campaigns: CampaignSummary[];
  let campaignId: string | null;
  if (initialCampaigns !== undefined) {
    campaigns = initialCampaigns;
    campaignId = initialCampaignId ?? null;
  } else {
    campaigns = await listActiveCampaigns();
    const cookieStore = await cookies();
    const cookieCampaign = cookieStore.get("fc_active_campaign")?.value;
    campaignId = resolveCurrentCampaignId(campaigns, c ?? cookieCampaign);
  }

  if (!campaignId) {
    return (
      <NoCampaignsState />
    );
  }

  const activeCampaign = campaigns.find((cmp) => cmp.id === campaignId) ?? null;
  const drafts = await getDraftsReadyForReview(campaignId);

  return (
    <section id="review" className="section" style={{ marginTop: 0 }}>
      {/* V4 `.section-head` (lines 1527-1533) — title + subtitle verbatim. */}
      <div className="section-head">
        <div>
          <div className="section-title">
            Eyeball review — bulk accept / edit / discard
            {activeCampaign ? (
              <span style={{ color: "var(--text-dim)" }}>
                {" · "}
                {activeCampaign.name}
              </span>
            ) : null}
          </div>
          <div className="section-sub">
            One draft at a time. J / K to move, Enter to accept, E to edit, D to
            discard. Rule violations surface a suggested fix inline — you don&rsquo;t
            have to remember the rules.
          </div>
        </div>
        {/* V4 `.section-link` on the right (line 1532). Wired to the tracker
            for the active campaign so the founder can jump from the keyboard
            review stack into the full master sheet without losing campaign
            context. */}
        <Link
          href={`/tracker?c=${campaignId}`}
          className="section-link"
          title="Open the full tracker for this campaign (keeps the campaign selection)."
        >
          Go to tracker ({drafts.length}) &rarr;
        </Link>
      </div>

      <ReviewStack drafts={drafts} />
    </section>
  );
}

/**
 * Shown when no campaigns are visible to the session — usually means the
 * user is unauthenticated and RLS denied the `campaigns` read. Mirrors the
 * tracker page's equivalent empty state.
 */
function NoCampaignsState() {
  return (
    <div
      style={{
        margin: "0 auto",
        maxWidth: 640,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 32,
        textAlign: "center",
        boxShadow: "var(--shadow)",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
        No campaigns available
      </h1>
      <p
        style={{
          marginTop: 8,
          fontSize: 13,
          color: "var(--text-dim)",
          lineHeight: 1.55,
        }}
      >
        Sign in to load the review stack. Row-level security gates every table
        until an authenticated session is present.
      </p>
    </div>
  );
}
