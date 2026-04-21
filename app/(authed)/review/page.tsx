import { cookies } from "next/headers";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
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
}: {
  searchParams: SearchParams;
}) {
  const { c } = await searchParams;

  // Campaign resolution matches the pattern used by the tracker page:
  // ?c=<uuid> wins, else fall back to the `fc_active_campaign` cookie set
  // by the top-bar switcher, else the first active campaign.
  const campaigns = await listActiveCampaigns();
  const cookieStore = await cookies();
  const cookieCampaign = cookieStore.get("fc_active_campaign")?.value;
  const campaignId = resolveCurrentCampaignId(campaigns, c ?? cookieCampaign);

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
        {/* V4 `.section-link` on the right (line 1532). The "full list" lands
            in a later phase; shown as an inert affordance, title explains why. */}
        <span
          className="section-link"
          title="The full drafted-list view lands in a later phase."
          style={{ cursor: "not-allowed", opacity: 0.7 }}
        >
          Open full list ({drafts.length}) &rarr;
        </span>
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
