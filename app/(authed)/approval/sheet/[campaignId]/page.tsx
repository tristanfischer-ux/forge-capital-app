import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getPendingApproval,
  getApprovalCampaignMeta,
  type OutgoingApprovalRow,
} from "@/lib/queries/approval";
import { isSelfManaged } from "@/lib/queries/self-managed";

/**
 * Printable outgoing-sheet view for V4 §9 — what Stephan / Andrew / Olivier
 * actually sees in the Google Sheet they receive by email.
 *
 * Deliberately minimal chrome: no sidebar, no topbar pills, no walk-tour
 * strip — just the sheet. This is the surface Tristan copy-pastes or PDFs
 * and attaches to the approval email.
 *
 * DOM class names come from app/v4-mockup.css (`.approval-col`,
 * `.approval-col-head.out`, `.ach-arrow`, `.ach-title`, `.ach-sub`,
 * `.sheet-head-strip`, `.sh-left`, `.sh-title`, `.sh-meta`, `.sh-right`,
 * `.evidence-chip.pending`, `table.sheet`, `.firm-c`, `.contact-c`,
 * `.synth`, `.approve-blank`). The page is wrapped in a print-friendly
 * centred container so letterhead spacing is consistent.
 *
 * Data: `getPendingApproval(campaignId)` — same query as the main page's
 * outgoing column. One source of truth, two surfaces.
 */
export const dynamic = "force-dynamic";

type RouteParams = Promise<{ campaignId: string }>;

export default async function ApprovalSheetPage({
  params,
}: {
  params: RouteParams;
}) {
  const { campaignId } = await params;

  // Validate the campaign exists (and the session can read it). 404 on
  // unknown / RLS-denied — no leaky "campaign not found" page.
  const meta = await getApprovalCampaignMeta(campaignId);
  if (!meta) notFound();

  const rows = await getPendingApproval(campaignId);
  const todayLabel = formatDateHeader(new Date());
  // UX audit 2026-04-23 item #2: the approver sees this page and the
  // filename it suggests. Use `campaign_display_name` (migration 027)
  // so "AUDIT · Wren Aerospace · Investor" becomes "Wren Aerospace"
  // in the sheet title and the generated filename slug. Fall back to
  // the internal `campaign_name` when the column is unset.
  const displayName =
    meta.campaign_display_name?.trim() || meta.campaign_name || "Campaign";
  const campaignSlug = slugForFilename(displayName);
  // Self-managed campaigns (no counterpart_email) drop the "for <name>"
  // framing that reads awkwardly when Tristan is both sender and
  // approver. Codified 2026-04-23.
  const selfManaged = isSelfManaged({
    counterpart_email: meta.counterpart_email,
    counterpart_name: meta.counterpart_name,
  });

  return (
    <div
      style={{
        maxWidth: 960,
        margin: "24px auto 48px",
        padding: "0 16px",
      }}
    >
      {/* Printable-sheet header: campaign + back link. The back link is
          hidden on print so the PDF export is clean. */}
      <div
        className="no-print"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          fontSize: 12,
        }}
      >
        <Link
          href="/approval"
          style={{ color: "var(--accent)", textDecoration: "none" }}
        >
          &larr; Back to approval gate
        </Link>
        <span style={{ color: "var(--text-dim)" }}>
          Print or copy this view &middot; send to approver as Google Sheet
          or PDF
        </span>
      </div>

      {/* The sheet itself — V4 `.approval-col` wrapper so borders / radii
          match the main page exactly. */}
      <div className="approval-col">
        <div className="approval-col-head out">
          <span className="ach-arrow" aria-hidden="true">
            &rarr;
          </span>
          <div>
            <div className="ach-title">
              {selfManaged
                ? "Outgoing list — what will go out"
                : "Outgoing — what the approver sees"}
            </div>
          </div>
          <span className="ach-sub">
            Campaign: {displayName}
          </span>
        </div>

        <div className="sheet-head-strip">
          <div className="sh-left">
            <span className="sh-title">
              {selfManaged
                ? `${displayName} · ${todayLabel}`
                : `${todayLabel} Outreach Summary for ${displayName} v1`}
            </span>
            <span className="sh-meta">
              {" · "}
              {rows.length} new row{rows.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="sh-right">
            <span className="evidence-chip pending">
              <span className="dot" aria-hidden="true" />
              Awaiting reply
            </span>
          </div>
        </div>

        <table className="sheet">
          <thead>
            <tr>
              <th style={{ width: "30%" }}>Investor &middot; Contact</th>
              <th>Why them (synthesis)</th>
              <th style={{ width: "16%" }}>Comment</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>
                  No rows pending approval. Shortlist investors from Find a
                  Match to populate this sheet.
                </td>
              </tr>
            ) : (
              rows.map((row) => <SheetRow key={row.campaign_partner_id} row={row} />)
            )}
          </tbody>
        </table>

        {/* Footer explainer — V4 lines 1213-1215, verbatim copy. */}
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
              annotations per row &mdash; the parser reconciles each
              decision into the tracker when you ingest.
            </>
          ) : (
            <>
              is captured by the approver&rsquo;s reply email &mdash; their
              ok / not-for-me annotations are parsed back automatically.
              We never ask them to log in anywhere.
            </>
          )}
        </div>
      </div>

      {/* Hidden-on-print reference for sharing. */}
      <div
        className="no-print"
        style={{
          marginTop: 16,
          fontSize: 11,
          color: "var(--text-faint)",
          textAlign: "right",
        }}
      >
        Filename suggestion: {todayLabel.replace(/\s+/g, "")}-{campaignSlug}-approval.pdf
      </div>
    </div>
  );
}

/**
 * One printable row — identical markup to the main page's outgoing row so
 * the visual is by-construction consistent.
 */
function SheetRow({ row }: { row: OutgoingApprovalRow }) {
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
 * Formats today as "YYMMDD" to match Tristan's Google Sheet naming
 * convention visible in V4 line 1170 ("260421 Outreach Summary for Stephan").
 */
function formatDateHeader(d: Date): string {
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

/** Lowercase + hyphenate a campaign name for use in filenames. */
function slugForFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "campaign";
}
