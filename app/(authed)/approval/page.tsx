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
import {
  isSelfManaged,
  counterpartDisplayName,
  counterpartPossessive as counterpartPossessiveFor,
} from "@/lib/queries/self-managed";
import ApprovalReturnDropZone from "./ApprovalReturnDropZone";
import { EmailApprovalListButton } from "./EmailApprovalListButton";
import { IncomingDecisionCell } from "./IncomingDecisionCell";
import { ContactPicker } from "../ContactPicker";
import { IngestIntoTrackerButton } from "./IngestIntoTrackerButton";

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
  // Self-managed campaigns (SkySails, Panatere, ForgeOS, Fischer Farms
  // Customer as of 2026-04-23) have no counterpart_email — Tristan is
  // both sender and approver. The shared helper in lib/queries/self-managed.ts
  // is the single source of truth; this page branches its copy on it.
  // `meta` carries counterpart_email since we updated getApprovalCampaignMeta.
  const selfManaged = isSelfManaged(
    meta
      ? {
          counterpart_email: meta.counterpart_email,
          counterpart_name: meta.counterpart_name,
        }
      : null,
  );
  const counterpartName = selfManaged
    ? counterpartDisplayName(
        meta
          ? {
              counterpart_email: meta.counterpart_email,
              counterpart_name: meta.counterpart_name,
            }
          : null,
      )
    : activeCampaign
      ? counterpartLabel(activeCampaign, "title")
      : "Counterpart TBD";
  const counterpartPhrase = activeCampaign
    ? counterpartLabel(activeCampaign, "phrase")
    : "the counterpart";
  const counterpartPossessive = selfManaged
    ? counterpartPossessiveFor(
        meta
          ? {
              counterpart_email: meta.counterpart_email,
              counterpart_name: meta.counterpart_name,
            }
          : null,
      )
    : activeCampaign
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
            {selfManaged ? (
              <>
                Three steps in the real sequence: (1) what will go out, (2)
                your approval notes, (3) decisions ready to ingest into the
                tracker. <b>Nothing is sent without your review.</b>
              </>
            ) : (
              <>
                Three steps in the real time sequence: (1) what{" "}
                {counterpartName} will see, (2) paste their reply so the
                parser can decode it, (3) the parsed decisions ready to
                ingest into the tracker.{" "}
                <b>Nothing is sent without your review.</b>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="walk-callout" style={{ marginBottom: 14 }}>
        <span className="wc-num">2</span>
        {selfManaged ? (
          <>
            <b>How the two-way artefact works.</b> The outgoing sheet below
            is plain Google Sheets &mdash; no log-in needed. When you email
            it to yourself on your phone, you reply with{" "}
            <code>ok / no / flag / skip</code> per row; the parser pulls
            decisions into the bottom panel. Hit <b>Ingest</b> when
            you&rsquo;re happy. Nothing sends automatically.
          </>
        ) : (
          <>
            <b>How the two-way artefact works.</b> The outgoing sheet below
            is plain Google Sheets &mdash; {counterpartName} doesn&rsquo;t
            log in anywhere. They reply by email with annotations. You
            paste that reply into the middle panel; the parser pulls the
            ok / flag / reject decisions into the bottom panel. You read
            any flagged rows and hit <b>Ingest</b> — only then do approved
            partners move forward. Nothing sends automatically.
          </>
        )}
      </div>

      {/* Email the list to a reviewer (e.g. when Tristan is away from his
          desk and wants to approve/reject rows from his phone). On
          self-managed campaigns (no counterpart_email) the reviewer is
          Tristan himself — copy flips to first-person. */}
      <section
        style={{
          marginBottom: 14,
          padding: "12px 14px",
          background: "var(--surface-alt)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          fontSize: 12,
        }}
      >
        <div style={{ marginBottom: 6, color: "var(--text-dim)" }}>
          <b style={{ color: "var(--text)" }}>Approve on phone</b>
          {selfManaged ? (
            <>
              {" "}— email the list to yourself, reply with{" "}
              <code>ok / no / flag / skip</code> per row from your Mail
              app, Step 2 below ingests the annotations.
            </>
          ) : (
            <>
              {" "}— email the outgoing list as plain text. Reply with{" "}
              <code>ok / no / flag / skip</code> per row; Step 2 below
              ingests the annotations.
            </>
          )}
        </div>
        <EmailApprovalListButton campaignId={campaignId} />
      </section>

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
          selfManaged={selfManaged}
          campaignIntent={meta?.campaign_intent ?? null}
        />
        <ApprovalReturnDropZone
          campaignId={campaignId}
          counterpartName={counterpartName}
        />
        <IncomingColumn
          campaignId={campaignId}
          rows={incoming.rows}
          stats={incoming.stats}
          counterpartName={counterpartName}
          counterpartPossessive={counterpartPossessive}
          selfManaged={selfManaged}
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
  selfManaged,
  campaignIntent,
}: {
  campaignId: string;
  rows: OutgoingApprovalRow[];
  counterpartName: string;
  counterpartPossessive: string;
  /** True when the campaign has no external counterpart — Tristan is
   *  both sender and approver. Swaps "what X will see" for "outgoing
   *  list" and the evidence-footer wording accordingly. */
  selfManaged: boolean;
  /** Campaign intent — drives column-header noun (Investor / Customer /
   *  Supplier · Contact). Null before the meta query has resolved. */
  campaignIntent: "investor" | "customer" | "supplier" | null;
}) {
  // Column-header noun. Customer and supplier campaigns read "Customer
  // · Contact" / "Supplier · Contact" instead of the V4-default
  // "Investor · Contact".
  const contactColumnHeader =
    campaignIntent === "customer"
      ? "Customer · Contact"
      : campaignIntent === "supplier"
        ? "Supplier · Contact"
        : "Investor · Contact";
  const count = rows.length;
  // Filename is honest about what it represents — no more hardcoded
  // demo "Stephan TF v12". Date = today's ISO; counterpart initial
  // stripped cleanly. On self-managed campaigns the title just reads
  // "Outreach summary · YYYY-MM-DD" — no "for <name>" suffix, since
  // the name is "you".
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const sheetTitle = selfManaged
    ? `Outreach summary · ${today}`
    : counterpartName === "Counterpart TBD"
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
            Step 1 &mdash; outgoing sheet{" "}
            {selfManaged
              ? "(the list that will go out)"
              : `(what ${counterpartName} will see)`}
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
            <th style={{ width: "30%" }}>{contactColumnHeader}</th>
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
        <b style={{ color: "var(--text)" }}>Evidence of approval</b>{" "}
        {selfManaged ? (
          <>
            is captured by your <code>ok / no / flag / skip</code>{" "}
            annotations per row &mdash; reply to the email you send
            yourself and the parser reconciles each decision into the
            tracker.
          </>
        ) : (
          <>
            is captured by {counterpartPossessive} reply email to this
            sheet &mdash; ok / not-for-me annotations are parsed back
            automatically. We never ask them to log in anywhere.
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One outgoing-sheet row — firm + primary contact on the left, synthesis
 * in the middle, em-dash in the "Comment SW" slot (the approver fills
 * that in on reply).
 *
 * The contact line is now a ContactPicker chip — click to see every
 * known contact at the firm (multi-contact-per-org support, Tristan
 * 2026-04-24). Swapping the contact clears the cached draft +
 * cancels any pending scheduled_sends (regenerate-from-scratch on
 * swap, per Tristan's instruction).
 */
function OutgoingRow({ row }: { row: OutgoingApprovalRow }) {
  const chipLabel =
    [row.partner_name, row.partner_title]
      .filter((s): s is string => !!s && s.trim().length > 0)
      .join(" · ") || "— no contact —";
  const hqSuffix = row.hq_location ? ` · ${row.hq_location}` : "";

  return (
    <tr>
      <td>
        <div className="firm-c">{row.firm_name ?? "—"}</div>
        <div className="contact-c">
          <ContactPicker
            campaignPartnerId={row.campaign_partner_id}
            currentLabel={chipLabel}
          />
          {hqSuffix ? (
            <span style={{ color: "var(--text-faint)" }}>{hqSuffix}</span>
          ) : null}
        </div>
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
  campaignId,
  rows,
  stats,
  counterpartName,
  counterpartPossessive,
  selfManaged,
}: {
  campaignId: string;
  rows: IncomingApprovalRow[];
  stats: IncomingApprovalStats;
  counterpartName: string;
  counterpartPossessive: string;
  /** True when Tristan is both sender and approver — swaps the
   *  "latest reply from <counterpart>" empty-state copy for a
   *  first-person variant. */
  selfManaged: boolean;
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
            : selfManaged
              ? "No approvals parsed yet"
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
          {selfManaged ? (
            <>
              Reply parser reads your inline{" "}
              <code>ok / no / flag / skip</code> annotations per row.
            </>
          ) : (
            <>
              Reply parser reads {counterpartPossessive} inline{" "}
              &ldquo;ok&rdquo; / &ldquo;not for us&rdquo; / &ldquo;tell me
              more&rdquo; annotations.
            </>
          )}
        </div>
      </div>

      {/* V4 lines 1254-1284 — replies table. */}
      <IncomingRepliesTable
        campaignId={campaignId}
        rows={rows}
        hasRealData={hasRealData}
      />

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
        <IngestIntoTrackerButton
          campaignId={campaignId}
          approvedCount={stats.approved}
        />
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
  campaignId,
  rows,
  hasRealData,
}: {
  campaignId: string;
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
            {/* UX audit 2026-04-23 item #12: widened to 22% to fit the
                confidence badge + override affordance alongside the
                decision chip. */}
            <th style={{ width: "22%" }}>Decision</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <IncomingRow
              key={row.campaign_partner_id}
              campaignId={campaignId}
              row={row}
            />
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

/** One real incoming-reply row. UX audit 2026-04-23 item #12: the
 *  decision cell now includes the Haiku parser's confidence score as a
 *  coloured badge (green ≥ 85%, amber 60–84%, red < 60%) and exposes a
 *  "Click to change" inline override UI when confidence is low, so a
 *  mis-parse is never silent. */
function IncomingRow({
  campaignId,
  row,
}: {
  campaignId: string;
  row: IncomingApprovalRow;
}) {
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
        <IncomingDecisionCell
          campaignId={campaignId}
          campaignPartnerId={row.campaign_partner_id}
          decision={row.decision}
          parseConfidence={row.parse_confidence}
        />
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
