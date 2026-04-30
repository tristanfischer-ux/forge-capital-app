import { getDraftsByCampaign } from "@/lib/queries/drafts";
import type { DraftGroup, DraftRow } from "@/lib/queries/drafts";
import { InlineEditDraft } from "./InlineEditDraft";
import { DiscardDraftButton } from "./DiscardDraftButton";

/**
 * V4 §8 Gmail drafts panel — 1:1 port of Phase2-Mockup-V4.html lines
 * 1715-1796.
 *
 * V4 class vocabulary used verbatim (from app/v4-mockup.css):
 *   - `.section` / `.section-head` / `.section-title` / `.section-sub` /
 *     `.section-link`
 *   - `.approval-col`              — white rounded panel, overflow hidden
 *   - `.sheet-head-strip`          — indigo-softer title bar
 *     + `.sh-left` / `.sh-title` / `.sh-meta` / `.sh-right`
 *   - `.evidence-chip` + `.evidence-chip.pending` + `.evidence-chip .dot`
 *   - `table.sheet` / `.sheet thead th` / `.sheet tbody td`
 *     + `.firm-c` / `.contact-c` / `.comment-af`
 *   - `.tag-chip.tag-status` (Investor) + inline Customer/Supplier swatches
 *     matching the V4 mock's hard-coded pill colours
 *   - `.btn-gmail`                  — "Open ↗" anchor, renders as a real
 *                                      link in production (opens Gmail in a
 *                                      new tab).
 *
 * Data source (V1): `campaign_partners` WHERE `status_code='+2'` across
 * every campaign. Each row's draft is composed on-the-fly from the
 * campaign's `email_templates` row against the partner's firm/thesis
 * (see `./renderDraft.ts`). Real Gmail-OAuth draft wiring is Phase 4 —
 * the "Open ↗" link stubs to the Gmail inbox.
 *
 * Empty state: V1 has no +2 rows yet. When the query returns an empty
 * array we render the same honest copy the sidebar already uses
 * ("No drafts ready. Drafts land here when partners move to +2 Drafted.").
 */
export const dynamic = "force-dynamic";

export default async function DraftsPage() {
  const groups = await getDraftsByCampaign();

  const draftCount = groups.reduce((sum, g) => sum + g.drafts.length, 0);
  const campaignCount = groups.length;

  return (
    <section id="drafts" className="section" style={{ marginTop: 0 }}>
      {/* V4 `.section-head` (lines 1716-1722) — title + subtitle verbatim. */}
      <div className="section-head">
        <div>
          <div className="section-title">
            Gmail drafts panel &mdash; grouped by campaign
          </div>
          <div className="section-sub">
            Reviewed drafts live here until you hit send.{" "}
            <b>We never auto-send.</b> This tool opens Gmail; Gmail sends.
          </div>
        </div>
        {/* V4 line 1721 — inline <code> chip. Rendered as an anchor to Gmail
            so clicking opens the real Gmail tab at the outreach/drafts label.
            Real label creation lands in Phase 4. */}
        <a
          className="section-link"
          href="https://mail.google.com/mail/u/0/#label/outreach%2Fdrafts"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open{" "}
          <code
            style={{
              fontFamily: "'SF Mono', ui-monospace, Menlo, monospace",
              fontSize: 11,
              background: "var(--surface-alt)",
              padding: "1px 5px",
              borderRadius: 3,
            }}
          >
            outreach/drafts
          </code>{" "}
          label &#8599;
        </a>
      </div>

      {draftCount === 0 ? (
        <DraftsEmptyState />
      ) : (
        <DraftsPanel
          groups={groups}
          draftCount={draftCount}
          campaignCount={campaignCount}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------
   Populated panel — V4 lines 1724-1795
   ------------------------------------------------------------------ */

function DraftsPanel({
  groups,
  draftCount,
  campaignCount,
}: {
  groups: DraftGroup[];
  draftCount: number;
  campaignCount: number;
}) {
  // All draft rows flattened, in the same order groups were returned
  // (campaign A→Z, within campaign: last_contact_at DESC). Matches the
  // V4 table layout which does not sub-group into per-campaign bands.
  const rows = groups.flatMap((g) =>
    g.drafts.map((d) => ({ group: g, draft: d })),
  );

  return (
    <div className="approval-col" style={{ overflow: "hidden" }}>
      {/* V4 `.sheet-head-strip` (lines 1725-1735) — indigo title bar with
          per-campaign evidence chips. */}
      <div className="sheet-head-strip">
        <div className="sh-left">
          <span className="sh-title">
            {draftCount} {draftCount === 1 ? "draft" : "drafts"} ready in Gmail
            &middot; {campaignCount}{" "}
            {campaignCount === 1 ? "campaign" : "campaigns"}
          </span>
          <span className="sh-meta">&middot; live from the tracker</span>
        </div>
        <div className="sh-right">
          {groups.map((g) => (
            <CampaignChip key={g.campaign_id} group={g} />
          ))}
        </div>
      </div>

      {/* V4 `<table class="sheet">` (lines 1736-1789). Columns + widths
          match the mockup. Action column widened to hold Draft ↗ + Edit + Discard. */}
      <table className="sheet">
        <thead>
          <tr>
            <th style={{ width: "20%" }}>To</th>
            <th style={{ width: "12%" }}>Campaign</th>
            <th style={{ width: "26%" }}>Subject</th>
            <th>Opening line</th>
            <th style={{ width: "7%" }}>Saved</th>
            <th style={{ width: "17%" }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ group, draft }) => (
            <DraftRow
              key={`${group.campaign_id}:${draft.partner_id}`}
              group={group}
              draft={draft}
            />
          ))}
        </tbody>
      </table>

      {/* V4 footer strip (lines 1790-1794) — authority reminder. */}
      <div
        style={{
          padding: "10px 16px",
          background: "var(--surface-alt)",
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 11,
          color: "var(--text-dim)",
        }}
      >
        <span>
          Showing {draftCount} of {draftCount}{" "}
          {draftCount === 1 ? "draft" : "drafts"}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ color: "var(--accent)", fontWeight: 600 }}>
          &larr; Click Draft ↗ to open the full composer — refine the synthesis,
          create a Gmail draft, or send directly. We never auto-send.
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Row
   ------------------------------------------------------------------ */

function DraftRow({ group, draft }: { group: DraftGroup; draft: DraftRow }) {
  const partnerLabel = draft.partner_name ?? "—";
  const firmLabel = draft.firm_name ?? "—";

  return (
    <tr>
      <td>
        <div className="firm-c">{partnerLabel}</div>
        <div className="contact-c">{firmLabel}</div>
      </td>
      <td>
        <IntentChip intent={group.campaign_intent} />
        <div className="contact-c" style={{ marginTop: 3 }}>
          {group.campaign_name}
        </div>
      </td>
      <td>{draft.subject}</td>
      <td className="comment-af">{draft.snippet}</td>
      <td>{draft.saved_ago}</td>
      <td style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <a
          className="btn-gmail"
          href={`/tracker/${draft.partner_id}/draft`}
          title="Open the full draft composer for this partner — edit, refine synthesis, create Gmail draft, or send."
        >
          Draft &#8599;
        </a>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------
   Chips
   ------------------------------------------------------------------ */

/**
 * Per-campaign intent pill shown inside each table row. Mirrors V4's
 * hard-coded colour choices per archetype:
 *   - investor  → `.tag-chip.tag-status`  (indigo)
 *   - customer  → green swatch (V4 inline style line 1766)
 *   - supplier  → amber swatch (V4 inline style line 1774)
 */
function IntentChip({ intent }: { intent: DraftGroup["campaign_intent"] }) {
  if (intent === "investor") {
    return (
      <span className="tag-chip tag-status" style={{ fontSize: 10 }}>
        Investor
      </span>
    );
  }
  if (intent === "customer") {
    return (
      <span
        className="tag-chip"
        style={{
          fontSize: 10,
          background: "#dcfce7",
          color: "#14532d",
          borderColor: "#86efac",
        }}
      >
        Customer
      </span>
    );
  }
  return (
    <span
      className="tag-chip"
      style={{
        fontSize: 10,
        background: "#fef3c7",
        color: "#78350f",
        borderColor: "#fcd34d",
      }}
    >
      Supplier
    </span>
  );
}

/**
 * Small count pill shown inside a campaign chip — displays the number of
 * drafts in that campaign as a distinct badge so the count reads clearly
 * at a glance alongside the campaign name.
 */
function DraftCountPill({
  count,
  intent,
}: {
  count: number;
  intent: DraftGroup["campaign_intent"];
}) {
  const style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 18,
    height: 18,
    padding: "0 5px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1,
    marginLeft: 5,
  };

  if (intent === "investor") {
    return (
      <span
        style={{
          ...style,
          background: "var(--accent)",
          color: "#fff",
        }}
      >
        {count}
      </span>
    );
  }
  if (intent === "customer") {
    return (
      <span
        style={{
          ...style,
          background: "var(--green)",
          color: "#fff",
        }}
      >
        {count}
      </span>
    );
  }
  // Supplier — amber
  return (
    <span
      style={{
        ...style,
        background: "var(--amber)",
        color: "#fff",
      }}
    >
      {count}
    </span>
  );
}

/**
 * Campaign summary chip on the right of the sheet-head-strip. Colours
 * match V4's hard-coded pill swatches: investor = indigo (default
 * `.evidence-chip` is green, so we colour investor indigo inline);
 * customer = green (default); supplier = amber (`.pending` variant).
 *
 * The draft count is now shown as a distinct `DraftCountPill` badge
 * rather than inline text, so the number reads clearly at a glance.
 */
function CampaignChip({ group }: { group: DraftGroup }) {
  const count = group.drafts.length;
  if (group.campaign_intent === "supplier") {
    return (
      <span className="evidence-chip pending">
        <span className="dot" />
        {group.campaign_name}
        <DraftCountPill count={count} intent="supplier" />
      </span>
    );
  }
  if (group.campaign_intent === "customer") {
    return (
      <span className="evidence-chip">
        <span className="dot" style={{ background: "var(--green)" }} />
        {group.campaign_name}
        <DraftCountPill count={count} intent="customer" />
      </span>
    );
  }
  // Investor — V4 uses the default indigo chip (line 1731).
  return (
    <span
      className="evidence-chip"
      style={{
        background: "var(--accent-softer)",
        color: "var(--accent-dark)",
        borderColor: "#e0dcff",
      }}
    >
      <span className="dot" style={{ background: "var(--accent)" }} />
      {group.campaign_name}
      <DraftCountPill count={count} intent="investor" />
    </span>
  );
}

/* ------------------------------------------------------------------
   Empty state — honest copy, matches the sidebar's DraftsEmpty
   ------------------------------------------------------------------ */

function DraftsEmptyState() {
  return (
    <div className="approval-col" style={{ overflow: "hidden" }}>
      <div className="sheet-head-strip">
        <div className="sh-left">
          <span className="sh-title">0 drafts ready in Gmail</span>
          <span className="sh-meta">&middot; nothing at +2 Drafted yet</span>
        </div>
      </div>
      <div
        style={{
          padding: "32px 24px",
          textAlign: "center",
          fontSize: 13,
          color: "var(--text-dim)",
          lineHeight: 1.55,
        }}
      >
        No drafts ready. Drafts land here when partners move to{" "}
        <span
          style={{
            fontFamily: "'SF Mono', ui-monospace, Menlo, monospace",
            fontSize: 12,
            color: "var(--text)",
          }}
        >
          +2 Drafted
        </span>
        .
      </div>
      <div
        style={{
          padding: "10px 16px",
          background: "var(--surface-alt)",
          borderTop: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--accent)",
          fontWeight: 600,
          textAlign: "right",
        }}
      >
        &larr; Gmail is authoritative. We never touch &ldquo;send&rdquo;.
      </div>
    </div>
  );
}
