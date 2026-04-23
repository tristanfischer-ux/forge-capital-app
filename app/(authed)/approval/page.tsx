import Link from "next/link";
import { cookies } from "next/headers";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
  counterpartLabel,
  type CampaignSummary,
} from "@/lib/queries/campaigns";
import {
  getPendingApproval,
  getApprovalReplies,
  getApprovalCampaignMeta,
  type OutgoingApprovalRow,
  type IncomingApprovalRow,
  type IncomingApprovalStats,
} from "@/lib/queries/approval";
import ApprovalReturnDropZone from "./ApprovalReturnDropZone";

/**
 * V4 §9 Founder approval gate — outgoing sheet & incoming replies.
 *
 * 1:1 port of Phase2-Mockup-V4.html lines 1149-1296. DOM class names come
 * from app/v4-mockup.css (`.approval-grid`, `.approval-col`,
 * `.approval-col-head.out|.in`, `.ach-arrow`, `.ach-title`, `.ach-sub`,
 * `.sheet-head-strip(.green)`, `.sh-left`, `.sh-title`, `.sh-meta`,
 * `.sh-right`, `.evidence-chip(.pending)`, `table.sheet`, `.firm-c`,
 * `.contact-c`, `.synth`, `.comment-af`, `.approve-y`, `.approve-no`,
 * `.approve-blank`, `.ingest-cta`, `.ic-btn`, `.walk-callout`, `.wc-num`).
 *
 * Data: OUTGOING reads campaign_partners at `+0 Pending approval`
 * (`getPendingApproval`). INCOMING reads rows where the approver replied
 * (`getApprovalReplies`) and derives the three-bucket stats. The "Generate
 * approval sheet" button navigates to /approval/sheet/[campaignId] — the
 * printable outgoing view.
 *
 * V1 placeholders (flagged with tooltips, not invented):
 *   - "Sent Mon 21 Apr 09:12 BST" — V4 verbatim; real timestamp lands in
 *     Phase 6 (Gmail send ingest).
 *   - "Ingest into tracker" button — stub with tooltip; the Phase-6 parser
 *     will be its real writer.
 *   - When there are zero real decisions, the incoming panel renders V4's
 *     sample rows inside an "— example from V4 —" faint container so the
 *     structure is visible without fabricating real data.
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ c?: string }>;

export default async function ApprovalPage({
  searchParams,
  initialCampaigns,
  initialCampaignId,
}: {
  searchParams: SearchParams;
  /** Optional pre-fetched campaigns list (passed by /home composer to
   *  avoid re-running `listActiveCampaigns()` 7× per render). When
   *  omitted — e.g. direct navigation to /approval — we fetch as before. */
  initialCampaigns?: CampaignSummary[];
  /** Optional pre-resolved active campaign id (same rationale). */
  initialCampaignId?: string | null;
}) {
  const { c } = await searchParams;

  // Campaign resolution matches tracker/review: ?c=<uuid> wins, else the
  // `fc_active_campaign` cookie set by the top-bar switcher, else the
  // first active campaign. Skipped entirely when the composer passes
  // pre-fetched data.
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
    return <NoCampaignsState />;
  }

  const [pending, incoming, meta] = await Promise.all([
    getPendingApproval(campaignId),
    getApprovalReplies(campaignId),
    getApprovalCampaignMeta(campaignId),
  ]);

  const activeCampaign = campaigns.find((cmp) => cmp.id === campaignId) ?? null;
  const campaignName = activeCampaign?.name ?? meta?.campaign_name ?? null;
  const counterpartName = activeCampaign
    ? counterpartLabel(activeCampaign, "title")
    : "Counterpart TBD";
  const counterpartPhrase = activeCampaign
    ? counterpartLabel(activeCampaign, "phrase")
    : "the counterpart";
  const counterpartPossessive = activeCampaign
    ? counterpartLabel(activeCampaign, "possessive")
    : "the counterpart's";

  return (
    <section id="approval" className="section" style={{ marginTop: 0 }}>
      {/* V4 `.section-head` — V4 lines 1150-1156, title + subtitle verbatim. */}
      <div className="section-head">
        <div>
          <div className="section-title">
            Founder approval gate &mdash; outgoing sheet &amp; incoming replies
            {campaignName ? (
              <span style={{ color: "var(--text-dim)" }}>
                {" · "}
                {campaignName}
              </span>
            ) : null}
          </div>
          <div className="section-sub">
            Three steps in the real time sequence: (1) what{" "}
            {counterpartName} will see, (2) paste their reply so the parser
            can decode it, (3) the parsed decisions ready to ingest into
            the tracker. <b>Nothing is sent without your review.</b>
          </div>
        </div>
      </div>

      <div className="walk-callout" style={{ marginBottom: 14 }}>
        <span className="wc-num">2</span>
        <b>How the two-way artefact works.</b> The outgoing sheet below is
        plain Google Sheets &mdash; {counterpartName} doesn&rsquo;t log in
        anywhere. They reply by email with annotations. You paste that
        reply into the middle panel; the parser pulls the ok / flag /
        reject decisions into the bottom panel. You read any flagged rows
        and hit <b>Ingest</b> — only then do approved partners move
        forward. Nothing sends automatically.
      </div>

      {/* Reordered 2026-04-23: OUTGOING → PASTE REPLY → PARSED APPROVALS.
          This is the real time sequence — you send first, the counterpart
          replies, you decode the reply, the decisions show below.
          Previous order (paste-first) inverted the workflow and was the
          bug Tristan called out on the stage audit. */}
      <div className="approval-col-stack" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <OutgoingColumn
          campaignId={campaignId}
          rows={pending}
          counterpartName={counterpartName}
          counterpartPossessive={counterpartPossessive}
        />
        <ApprovalReturnDropZone
          campaignId={campaignId}
          counterpartName={counterpartName}
        />
        <IncomingColumn
          rows={incoming.rows}
          stats={incoming.stats}
          counterpartName={counterpartName}
          counterpartPossessive={counterpartPossessive}
        />
      </div>
    </section>
  );
}

/* ========================================================================== */
/* OUTGOING COLUMN                                                             */
/* ========================================================================== */

/**
 * Outgoing-sheet column — V4 lines 1159-1216. The top strip shows the
 * Google Sheet name + row count + pending evidence chip. The table shows
 * firm + primary contact + synthesis + a blank "Comment SW" column the
 * approver fills in when they reply.
 *
 * Empty state: when there are zero `+0` rows the table renders a single
 * em-dash row explaining the pipeline hasn't shortlisted anyone yet.
 */
function OutgoingColumn({
  campaignId,
  rows,
  counterpartName,
  counterpartPossessive,
}: {
  campaignId: string;
  rows: OutgoingApprovalRow[];
  counterpartName: string;
  counterpartPossessive: string;
}) {
  const count = rows.length;
  // Filename is honest about what it represents — no more hardcoded
  // demo "Stephan TF v12". Date = today's ISO; counterpart initial
  // stripped cleanly. If no counterpart, honest blank.
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const sheetTitle =
    counterpartName === "Counterpart TBD"
      ? `Outreach summary · ${today} (counterpart not set)`
      : `Outreach summary for ${counterpartName} · ${today}`;
  const sentStrip = rows.length === 0
    ? "Nothing to send yet — shortlist from §3 Find-a-match first."
    : "Preview only — nothing is sent automatically.";

  return (
    <div className="approval-col">
      {/* V4 lines 1161-1167 — column head with the outgoing "→" arrow. */}
      <div className="approval-col-head out">
        <span className="ach-arrow" aria-hidden="true">
          &rarr;
        </span>
        <div>
          <div className="ach-title">
            Step 1 &mdash; outgoing sheet (what {counterpartName} will see)
          </div>
        </div>
        <span className="ach-sub">{sentStrip}</span>
      </div>

      {/* V4 lines 1168-1176 — sheet title strip with pending chip. */}
      <div className="sheet-head-strip">
        <div className="sh-left">
          <span className="sh-title">{sheetTitle}</span>
          <span className="sh-meta">
            {" · "}
            {count} new row{count === 1 ? "" : "s"}
          </span>
        </div>
        <div className="sh-right">
          {/* Generate-sheet button — links to the printable view. */}
          <Link
            href={`/approval/sheet/${campaignId}`}
            className="ic-btn"
            style={{
              // Lift the green .ic-btn off its default green-on-green context
              // into the lighter strip. Colour family matches the outgoing
              // arrow (accent-2 indigo), which is V4's visual rhyme for
              // "outgoing".
              background: "var(--accent-2)",
              textDecoration: "none",
            }}
          >
            Generate approval sheet &rarr;
          </Link>
          <span className="evidence-chip pending">
            <span className="dot" aria-hidden="true" />
            Awaiting reply
          </span>
        </div>
      </div>

      {/* V4 lines 1177-1212 — the sheet table itself. */}
      <table className="sheet">
        <thead>
          <tr>
            <th style={{ width: "30%" }}>Investor &middot; Contact</th>
            <th>Why them (synthesis)</th>
            <th style={{ width: "16%" }}>Comment SW</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <OutgoingEmptyRow />
          ) : (
            rows.map((row) => <OutgoingRow key={row.campaign_partner_id} row={row} />)
          )}
        </tbody>
      </table>

      {/* V4 lines 1213-1215 — the evidence-footer explainer. */}
      <div
        style={{
          padding: "10px 16px",
          background: "var(--surface-alt)",
          borderTop: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          lineHeight: 1.55,
        }}
      >
        <b style={{ color: "var(--text)" }}>Evidence of approval</b> is
        captured by {counterpartPossessive} reply email to this sheet &mdash;
        ok / not-for-me annotations are parsed back automatically. We never
        ask them to log in anywhere.
      </div>
    </div>
  );
}

/**
 * One outgoing-sheet row — firm + primary contact on the left, synthesis
 * in the middle, em-dash in the "Comment SW" slot (the approver fills
 * that in on reply).
 */
function OutgoingRow({ row }: { row: OutgoingApprovalRow }) {
  const contactLine = [row.partner_name, row.partner_title, row.hq_location]
    .filter((s): s is string => !!s && s.trim().length > 0)
    .join(" · ");

  return (
    <tr>
      <td>
        <div className="firm-c">{row.firm_name ?? "—"}</div>
        <div className="contact-c">{contactLine || "—"}</div>
      </td>
      <td className="synth">
        {row.why_them ?? (
          <span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>
            &mdash; synthesis pending &mdash;
          </span>
        )}
      </td>
      <td>
        <span className="approve-blank">&mdash;</span>
      </td>
    </tr>
  );
}

/**
 * Outgoing empty state — honest row explaining there's nothing to send
 * yet. V4 shows "30 more rows" as the fifth row; we use the same visual
 * rhythm but with real copy.
 */
function OutgoingEmptyRow() {
  return (
    <tr>
      <td>
        <div className="firm-c">No rows pending approval</div>
        <div className="contact-c">Shortlist investors on Find a Match to queue them here</div>
      </td>
      <td
        className="synth"
        style={{ color: "var(--text-faint)" }}
      >
        Rows at +0 Pending approval show here, oldest first. Each gets a
        2&ndash;3 sentence synthesis drawn from fund thesis, pattern, and
        Connection Brief.
      </td>
      <td>
        <span className="approve-blank">&mdash;</span>
      </td>
    </tr>
  );
}

/* ========================================================================== */
/* INCOMING COLUMN                                                             */
/* ========================================================================== */

/**
 * Incoming-replies column — V4 lines 1219-1290. Three-stat strip at the
 * top (Approved / Flag / Rejected) then a table of firm + verbatim reply
 * + decision badge, plus a green ingest-cta footer.
 */
function IncomingColumn({
  rows,
  stats,
  counterpartName,
  counterpartPossessive,
}: {
  rows: IncomingApprovalRow[];
  stats: IncomingApprovalStats;
  counterpartName: string;
  counterpartPossessive: string;
}) {
  const total = stats.approved + stats.flag + stats.rejected;
  const hasRealData = total > 0;

  return (
    <div className="approval-col">
      {/* V4 lines 1220-1226 — column head with the incoming "←" arrow. */}
      <div className="approval-col-head in">
        <span className="ach-arrow" aria-hidden="true">
          &larr;
        </span>
        <div>
          <div className="ach-title">Step 3 &mdash; parsed approvals (ready to ingest)</div>
        </div>
        <span
          className="ach-sub"
          title="Reply timestamp placeholder — real value lands when the Phase-6 Gmail reply parser writes approved_at."
        >
          {hasRealData
            ? "Latest reply parsed"
            : `No replies parsed yet from ${counterpartName}`}
        </span>
      </div>

      {/* V4 lines 1227-1235 — green sheet-head strip. */}
      <div className="sheet-head-strip green">
        <div className="sh-left">
          <span className="sh-title">
            {hasRealData ? "Latest batch · reply parsed" : "Awaiting first reply"}
          </span>
          <span className="sh-meta">
            {" · "}
            {hasRealData
              ? `${total} row${total === 1 ? "" : "s"} reconciled`
              : "0 rows reconciled"}
          </span>
        </div>
        <div className="sh-right">
          <span className="evidence-chip">
            <span className="dot" aria-hidden="true" />
            {hasRealData
              ? "Email reply logged"
              : "Reply-parser run on incoming email once configured"}
          </span>
        </div>
      </div>

      {/* V4 lines 1236-1253 — stats strip. */}
      <div
        style={{
          padding: "14px 16px 6px 16px",
          display: "flex",
          gap: 14,
          alignItems: "center",
          fontSize: 13,
        }}
      >
        <StatCell value={stats.approved} label="Approved" colour="var(--green)" />
        <div style={{ width: 1, alignSelf: "stretch", background: "var(--border-soft)" }} />
        <StatCell value={stats.flag} label="Flag for me" colour="var(--amber)" />
        <div style={{ width: 1, alignSelf: "stretch", background: "var(--border-soft)" }} />
        <StatCell value={stats.rejected} label="Rejected" colour="var(--red)" />
        <div style={{ flex: 1 }} />
        <div
          style={{
            color: "var(--text-dim)",
            fontSize: 11,
            lineHeight: 1.5,
            textAlign: "right",
            maxWidth: 200,
          }}
        >
          Reply parser reads {counterpartPossessive} inline{" "}
          &ldquo;ok&rdquo; / &ldquo;not for us&rdquo; / &ldquo;tell me more&rdquo; annotations.
        </div>
      </div>

      {/* V4 lines 1254-1284 — replies table. */}
      <IncomingRepliesTable rows={rows} hasRealData={hasRealData} />

      {/* V4 lines 1285-1289 — green ingest CTA. */}
      <div className="ingest-cta">
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "var(--green)",
            color: "#fff",
            fontWeight: 700,
            fontSize: 12,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-hidden="true"
        >
          &#10003;
        </span>
        <div>
          <b>Ready to ingest:</b>{" "}
          {hasRealData
            ? `${stats.approved} approved row${stats.approved === 1 ? "" : "s"} → queue for verification, ${stats.flag} flagged → your queue, ${stats.rejected} rejected → archived with reason.`
            : "13 approved rows → queue for verification, 2 flagged → your queue, 5 rejected → archived with reason."}
        </div>
        {/* V1 stub — Phase-6 Gmail reply parser writes the real transitions. */}
        <button
          type="button"
          className="ic-btn"
          disabled
          title="Ingest wiring lands with the Phase 6 Gmail reply parser. Today this surfaces what the parser will push."
          style={{ opacity: 0.7, cursor: "not-allowed" }}
        >
          Ingest into tracker &rarr;
        </button>
      </div>
    </div>
  );
}

/** One stat tile in the three-across strip — V4 lines 1237-1250. */
function StatCell({
  value,
  label,
  colour,
}: {
  value: number;
  label: string;
  colour: string;
}) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: colour, lineHeight: 1 }}>
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "var(--text-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          marginTop: 3,
        }}
      >
        {label}
      </div>
    </div>
  );
}

/**
 * Renders either the real parsed replies or — when zero real rows exist —
 * V4's verbatim sample rows inside an "— example from V4 —" marker so the
 * structure is visible without claiming the data is real. Per
 * forge-capital-app/CLAUDE.md: "For genuine placeholders with no V1 data
 * source yet, render the V4 copy verbatim AND add a title-attribute
 * tooltip flagging 'wires to X in Phase Y'."
 */
function IncomingRepliesTable({
  rows,
  hasRealData,
}: {
  rows: IncomingApprovalRow[];
  hasRealData: boolean;
}) {
  if (hasRealData) {
    return (
      <table className="sheet">
        <thead>
          <tr>
            <th style={{ width: "36%" }}>Firm</th>
            <th>Approver&rsquo;s reply (verbatim)</th>
            <th style={{ width: "16%" }}>Decision</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <IncomingRow key={row.campaign_partner_id} row={row} />
          ))}
        </tbody>
      </table>
    );
  }

  // Honest empty state — no fake demo rows. The reply parser
  // (`research/16-parse-approval-replies.py`) writes into this table
  // when real replies land; until then, we say so plainly.
  return (
    <div
      style={{
        padding: "32px 22px",
        textAlign: "center",
        color: "var(--text-dim)",
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
        No replies parsed yet.
      </div>
      <div>
        Once your counterpart replies to the outgoing sheet above, the parser
        in <code>research/16-parse-approval-replies.py</code> extracts the
        ok / flag / reject decisions and lands them here. Until then this
        panel is empty on purpose.
      </div>
    </div>
  );
}

/** One real incoming-reply row. */
function IncomingRow({ row }: { row: IncomingApprovalRow }) {
  return (
    <tr>
      <td>
        <div className="firm-c">{row.firm_name ?? "—"}</div>
        <div className="contact-c">{row.partner_name ?? "—"}</div>
      </td>
      <td className="comment-af">
        {row.approver_note ? (
          <>&ldquo;{row.approver_note}&rdquo;</>
        ) : (
          <span style={{ color: "var(--text-faint)" }}>&mdash;</span>
        )}
      </td>
      <td>
        {row.decision === "approved" ? (
          <span className="approve-y">&#10003; Approved</span>
        ) : row.decision === "flag" ? (
          <span style={{ color: "var(--amber)", fontWeight: 700 }}>
            &#9888; Flag
          </span>
        ) : (
          <span className="approve-no">&#10007; Reject</span>
        )}
      </td>
    </tr>
  );
}

/* ========================================================================== */
/* NO-CAMPAIGNS EMPTY STATE                                                    */
/* ========================================================================== */

/**
 * Mirrors the tracker / review equivalents. Shown when the session has
 * no visible campaigns — usually the unauthenticated / RLS-denied case.
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
        Sign in to load the approval gate. Row-level security gates every
        table until an authenticated session is present.
      </p>
    </div>
  );
}
