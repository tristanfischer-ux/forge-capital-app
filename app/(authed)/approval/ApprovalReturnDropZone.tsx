"use client";

import { useMemo, useState, useTransition } from "react";
import {
  parseApprovalReply,
  applyApprovalVerdicts,
  type ApprovalMatch,
  type UnmatchedLine,
  type Verdict,
  type VerdictInstruction,
} from "./actions";

/**
 * Approval-return drop-zone — surfaces the Python-script parser
 * (`research/16-parse-approval-replies.py`) as a paste / drag-drop
 * box at the top of the §9 Approval gate.
 *
 * Flow:
 *  1. Tristan pastes or drops an approver reply into the textarea.
 *     (Plain text only — if a user drags a `.txt` / `.md`, we read the
 *     file contents and drop them into the textarea so the same Haiku
 *     call path runs.)
 *  2. "Parse with Haiku" POSTs the body to `parseApprovalReply`, which
 *     calls claude-haiku-4-5-20251001 with a strict JSON prompt, fuzzy-
 *     matches firms against the campaign pool, and returns matches +
 *     unmatched.
 *  3. The review table shows each match with the current status →
 *     proposed verdict. Per-row buttons let Tristan toggle individual
 *     verdicts (Approve / Reject / Skip / Flag) or unselect a row before
 *     applying.
 *  4. "Apply selected" batch-writes via `applyApprovalVerdicts` and
 *     revalidates the page so the incoming-replies panel below refreshes
 *     with the new decisions.
 *
 * Honest degradation:
 *  - If `ANTHROPIC_API_KEY` is missing on the server, `parseApprovalReply`
 *    returns a structured error. We surface it verbatim in the status
 *    strip — no silent fabrication.
 *  - If Haiku returns zero lines (e.g. the paste was a signature block),
 *    we say "No decisions extracted — did the reply include ok / skip /
 *    not-for-me markers?" rather than pretending something parsed.
 */

interface ApprovalReturnDropZoneProps {
  campaignId: string;
  counterpartName: string;
}

type ReviewRow = ApprovalMatch & {
  /** Row-level chosen verdict (initial = Haiku's proposal). */
  chosen_verdict: Verdict;
  /** Editable note — seeded from Haiku's `proposed_note`. */
  edited_note: string;
  /** Whether Tristan wants this row applied. */
  selected: boolean;
  /** Result after apply — tracks per-row success / failure for the UX. */
  result?: "applied" | { error: string };
};

export default function ApprovalReturnDropZone({
  campaignId,
  counterpartName,
}: ApprovalReturnDropZoneProps) {
  const [replyText, setReplyText] = useState("");
  const [approverEmail, setApproverEmail] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [isParsing, startParse] = useTransition();
  const [isApplying, startApply] = useTransition();

  const [parseError, setParseError] = useState<string | null>(null);
  const [parseCount, setParseCount] = useState<number | null>(null);
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedLine[]>([]);
  const [applyReport, setApplyReport] = useState<{
    applied: number;
    failed: number;
  } | null>(null);

  const selectedCount = useMemo(
    () => reviewRows.filter((r) => r.selected).length,
    [reviewRows],
  );

  const hasParsed = reviewRows.length > 0 || unmatched.length > 0 || parseCount !== null;

  function resetResults() {
    setParseError(null);
    setParseCount(null);
    setReviewRows([]);
    setUnmatched([]);
    setApplyReport(null);
  }

  function onParse() {
    resetResults();
    startParse(async () => {
      const result = await parseApprovalReply({
        text: replyText,
        campaignId,
      });
      if (!result.ok) {
        setParseError(result.error);
        return;
      }
      setParseCount(result.parsed_count);
      setReviewRows(
        result.matches.map((m) => ({
          ...m,
          chosen_verdict: m.proposed_verdict,
          edited_note: m.proposed_note,
          selected: true,
        })),
      );
      setUnmatched(result.unmatched);
    });
  }

  function onApply() {
    const toApply: VerdictInstruction[] = reviewRows
      .filter((r) => r.selected)
      .map((r) => ({
        campaign_partner_id: r.campaign_partner_id,
        verdict: r.chosen_verdict,
        note: r.edited_note,
        approver_email: approverEmail || undefined,
        // UX audit 2026-04-23 item #12: persist Haiku's confidence so
        // the Step 3 table can render the coloured badge and future
        // batch operations have quality metadata available. When
        // Tristan manually overrode the verdict (chosen ≠ proposed),
        // clear the confidence — the score belongs to Haiku's call,
        // not the human correction.
        confidence:
          r.chosen_verdict === r.proposed_verdict ? r.confidence : null,
      }));
    if (toApply.length === 0) {
      setParseError("No rows selected — tick at least one before applying.");
      return;
    }
    setParseError(null);
    startApply(async () => {
      const result = await applyApprovalVerdicts({
        campaignId,
        verdicts: toApply,
      });
      if (!result.ok) {
        setParseError(result.error);
        return;
      }
      // Mark each row's result inline so Tristan sees the outcome
      // without the table disappearing.
      const failedById = new Map<string, string>(
        result.failed.map((f) => [f.campaign_partner_id, f.error]),
      );
      setReviewRows((rows) =>
        rows.map((r) => {
          if (!r.selected) return r;
          const failure = failedById.get(r.campaign_partner_id);
          return {
            ...r,
            result: failure ? { error: failure } : "applied",
          };
        }),
      );
      setApplyReport({ applied: result.applied, failed: result.failed.length });
    });
  }

  function updateRow(index: number, patch: Partial<ReviewRow>) {
    setReviewRows((rows) =>
      rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }

  async function handleFile(file: File) {
    if (!/\.(txt|md|eml)$/i.test(file.name)) {
      setParseError(
        `Drop a plain-text file (.txt / .md / .eml) or paste the reply body. Got ${file.name}.`,
      );
      return;
    }
    try {
      const text = await file.text();
      setReplyText((prev) => (prev ? `${prev}\n\n${text}` : text));
      setParseError(null);
    } catch (err) {
      setParseError(
        `Couldn't read file: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="approval-col" style={{ marginBottom: 18 }}>
      {/* Column head — matches the outgoing/incoming columns' chrome. */}
      <div className="approval-col-head in">
        <span className="ach-arrow" aria-hidden="true">
          &darr;
        </span>
        <div>
          <div className="ach-title">
            Step 2 &mdash; paste {counterpartName}&rsquo;s reply to parse
          </div>
        </div>
        <span className="ach-sub">
          Parser extracts ok / not-for-me / skip markers into Step 3
        </span>
      </div>

      {/* Paste box + file-drop surface. */}
      <div
        style={{
          padding: "14px 16px",
          position: "relative",
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <label
          htmlFor="approval-reply-text"
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text)",
            marginBottom: 6,
          }}
        >
          Reply body
        </label>
        <textarea
          id="approval-reply-text"
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder={`Paste an approval reply from your counterpart here — Haiku parses 'ok / not-for-me / skip' markers and proposes status changes per investor.

Example:
Regeneration.VC — ok
Deep Tech Seed Fund — not for us, already passed last round
Babel Ventures — flag, conflicting partner`}
          spellCheck={false}
          rows={8}
          style={{
            width: "100%",
            padding: "10px 12px",
            fontSize: 12,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            lineHeight: 1.5,
            color: "var(--text)",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            resize: "vertical",
            outline: "none",
          }}
        />

        {/* Drag overlay shown during file drag. */}
        {dragOver ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              margin: 14,
              background: "rgba(79, 70, 229, 0.08)",
              border: "2px dashed var(--accent)",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--accent)",
              fontSize: 13,
              fontWeight: 600,
              pointerEvents: "none",
            }}
          >
            Drop a .txt / .md / .eml file to load the reply
          </div>
        ) : null}

        {/* Action row — approver email + Parse button. */}
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            marginTop: 10,
            flexWrap: "wrap",
          }}
        >
          <input
            type="email"
            value={approverEmail}
            onChange={(e) => setApproverEmail(e.target.value)}
            placeholder={`Approver email (logs in approved_by) — optional`}
            style={{
              flex: "1 1 260px",
              padding: "8px 10px",
              fontSize: 12,
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
              background: "var(--surface)",
              outline: "none",
            }}
          />
          <button
            type="button"
            className="ic-btn"
            onClick={onParse}
            disabled={isParsing || !replyText.trim()}
            style={{
              background: "var(--accent-2)",
              opacity: isParsing || !replyText.trim() ? 0.6 : 1,
              cursor: isParsing || !replyText.trim() ? "not-allowed" : "pointer",
            }}
          >
            {isParsing ? "Parsing with Haiku…" : "Parse with Haiku →"}
          </button>
          {hasParsed ? (
            <button
              type="button"
              className="btn-gmail"
              onClick={() => {
                setReplyText("");
                resetResults();
              }}
            >
              Clear
            </button>
          ) : null}
        </div>

        {/* Status / error strip. */}
        {parseError ? (
          <div
            role="alert"
            style={{
              marginTop: 10,
              padding: "8px 12px",
              background: "var(--red-light)",
              border: "1px solid #fecaca",
              borderRadius: 6,
              color: "var(--red)",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {parseError}
          </div>
        ) : null}

        {parseCount !== null && !parseError ? (
          <div
            style={{
              marginTop: 10,
              padding: "8px 12px",
              background: "var(--surface-alt)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-dim)",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            Haiku extracted{" "}
            <b style={{ color: "var(--text)" }}>{parseCount}</b>{" "}
            decision{parseCount === 1 ? "" : "s"} &middot;{" "}
            <b style={{ color: "var(--text)" }}>{reviewRows.length}</b>{" "}
            matched to this campaign&rsquo;s pool,{" "}
            <b style={{ color: "var(--text)" }}>{unmatched.length}</b>{" "}
            couldn&rsquo;t be matched. Review before applying.
          </div>
        ) : null}

        {applyReport ? (
          <div
            style={{
              marginTop: 10,
              padding: "8px 12px",
              background: "var(--green-light)",
              border: "1px solid #bbf7d0",
              borderRadius: 6,
              color: "#065f46",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            Applied{" "}
            <b>{applyReport.applied}</b> update
            {applyReport.applied === 1 ? "" : "s"} to campaign_partners.
            {applyReport.failed > 0 ? (
              <>
                {" "}
                <b>{applyReport.failed}</b> row
                {applyReport.failed === 1 ? "" : "s"} failed &mdash; see the
                inline note per row.
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Review table. */}
      {reviewRows.length > 0 ? (
        <>
          <div
            style={{
              padding: "10px 16px",
              fontSize: 11,
              color: "var(--text-dim)",
              background: "var(--surface-alt)",
              borderTop: "1px solid var(--border)",
              borderBottom: "1px solid var(--border)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              fontWeight: 600,
            }}
          >
            Proposed changes &middot; {selectedCount} selected of{" "}
            {reviewRows.length}
          </div>
          <table className="sheet">
            <thead>
              <tr>
                <th style={{ width: "28%" }}>Firm &middot; reply name</th>
                <th style={{ width: "18%" }}>Current status</th>
                <th style={{ width: "26%" }}>Proposed verdict</th>
                <th>Note</th>
                <th style={{ width: "12%" }}>Apply?</th>
              </tr>
            </thead>
            <tbody>
              {reviewRows.map((row, idx) => (
                <ReviewTableRow
                  key={row.campaign_partner_id}
                  row={row}
                  onChange={(patch) => updateRow(idx, patch)}
                />
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {unmatched.length > 0 ? (
        <div
          style={{
            padding: "10px 16px",
            background: "var(--amber-light)",
            borderTop: "1px solid #fde68a",
            fontSize: 12,
            color: "var(--amber)",
            lineHeight: 1.6,
          }}
        >
          <b style={{ color: "#78350f" }}>
            {unmatched.length} name{unmatched.length === 1 ? "" : "s"} couldn
            &rsquo;t be matched to this campaign&rsquo;s pool:
          </b>
          <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
            {unmatched.map((u, i) => (
              <li key={`${u.reply_name}-${i}`}>
                <b style={{ color: "#78350f" }}>{u.reply_name}</b>{" "}
                &rarr; {u.verdict}
                {u.note ? `, ${u.note}` : ""} &middot;{" "}
                <span style={{ color: "#92400e" }}>
                  {u.reason === "ambiguous"
                    ? "multiple candidates in pool"
                    : "no candidate in pool"}
                </span>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 6, color: "#78400e", fontSize: 11 }}>
            Shortlist these firms on §3 Find a Match first, then re-parse.
          </div>
        </div>
      ) : null}

      {/* Apply footer — parallels the green ingest-cta on the incoming panel. */}
      {reviewRows.length > 0 ? (
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
            <b>Ready to apply:</b> {selectedCount} verdict
            {selectedCount === 1 ? "" : "s"} &rarr; campaign_partners.{" "}
            {approverEmail ? (
              <>
                Signing as{" "}
                <b style={{ color: "#065f46" }}>{approverEmail}</b>.
              </>
            ) : (
              <>
                Approver email not set &mdash; your own login will be used.
              </>
            )}
          </div>
          <button
            type="button"
            className="ic-btn"
            onClick={onApply}
            disabled={isApplying || selectedCount === 0}
            style={{
              opacity: isApplying || selectedCount === 0 ? 0.6 : 1,
              cursor: isApplying || selectedCount === 0 ? "not-allowed" : "pointer",
            }}
          >
            {isApplying
              ? "Applying…"
              : `Apply ${selectedCount} verdict${selectedCount === 1 ? "" : "s"} →`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Confidence badge                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Coloured pill showing Haiku's self-reported parser confidence.
 *
 * Tiers (UX audit 2026-04-23 item #12):
 *   - confidence >= 0.85 → green "high"
 *   - 0.60..0.84         → amber "review"
 *   - < 0.60             → red "low — confirm"
 *   - null               → neutral "no score"
 *
 * Sizing matches the existing `.approve-y` / `.approve-no` verdict
 * badges so the two tags sit side-by-side visually consistently.
 */
function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null || !Number.isFinite(confidence)) {
    return (
      <span
        title="Haiku didn't return a confidence score for this row — review manually before applying."
        style={{
          fontSize: 10,
          fontWeight: 600,
          padding: "1px 6px",
          borderRadius: 10,
          background: "var(--surface-alt)",
          color: "var(--text-dim)",
          border: "1px solid var(--border-soft)",
          fontFamily: "'SF Mono', monospace",
        }}
      >
        no score
      </span>
    );
  }
  const pct = Math.round(confidence * 100);
  const tier =
    confidence >= 0.85 ? "high" : confidence >= 0.6 ? "review" : "low";
  const { bg, fg, border, label } =
    tier === "high"
      ? {
          bg: "var(--green-light)",
          fg: "var(--green)",
          border: "#bbf7d0",
          label: `${pct}%`,
        }
      : tier === "review"
        ? {
            bg: "var(--amber-light)",
            fg: "var(--amber)",
            border: "#fde68a",
            label: `${pct}% · review`,
          }
        : {
            bg: "var(--red-light)",
            fg: "var(--red)",
            border: "#fecaca",
            label: `${pct}% · confirm`,
          };
  return (
    <span
      title={`Haiku confidence in this verdict: ${pct}%`}
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "1px 6px",
        borderRadius: 10,
        background: bg,
        color: fg,
        border: `1px solid ${border}`,
        fontFamily: "'SF Mono', monospace",
      }}
    >
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Review table row                                                           */
/* -------------------------------------------------------------------------- */

function ReviewTableRow({
  row,
  onChange,
}: {
  row: ReviewRow;
  onChange: (patch: Partial<ReviewRow>) => void;
}) {
  const reason = row.match_reason;

  const verdictOptions: Array<{ value: Verdict; label: string; hint: string }> = [
    { value: "ok", label: "Approve → +1", hint: "Approved, awaiting draft" },
    { value: "not_for_me", label: "Reject → −3", hint: "Disqualified" },
    { value: "skip", label: "Skip → −3", hint: "Disqualified, [SKIP] note" },
    { value: "maybe", label: "Flag → +0", hint: "Pending, [FLAG] note" },
  ];

  return (
    <tr style={row.result === "applied" ? { background: "var(--green-light)" } : undefined}>
      <td>
        <div className="firm-c" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span>{row.firm_name ?? "—"}</span>
          {/* UX audit 2026-04-23 item #12: surface Haiku's self-reported
              confidence so low-certainty rows are visibly reviewable
              BEFORE Tristan applies the batch. */}
          <ConfidenceBadge confidence={row.confidence} />
        </div>
        <div className="contact-c">
          {row.reply_name !== row.firm_name ? (
            <>
              reply: <b>{row.reply_name}</b>{" "}
              <span style={{ color: "var(--text-faint)" }}>
                ({reason.replace("_", " ")})
              </span>
            </>
          ) : (
            <span style={{ color: "var(--text-faint)" }}>
              matched exactly
            </span>
          )}
        </div>
      </td>
      <td>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {row.current_status_code ?? "—"}
          {row.current_status_label ? ` ${row.current_status_label}` : ""}
        </span>
      </td>
      <td>
        <select
          value={row.chosen_verdict}
          onChange={(e) => onChange({ chosen_verdict: e.target.value as Verdict })}
          style={{
            width: "100%",
            padding: "5px 6px",
            fontSize: 11,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--surface)",
            color: "var(--text)",
          }}
        >
          {verdictOptions.map((opt) => (
            <option key={opt.value} value={opt.value} title={opt.hint}>
              {opt.label}
            </option>
          ))}
        </select>
        {row.chosen_verdict !== row.proposed_verdict ? (
          <div
            style={{
              marginTop: 3,
              fontSize: 10,
              color: "var(--amber)",
              fontStyle: "italic",
            }}
          >
            overridden (Haiku said: {row.proposed_verdict})
          </div>
        ) : null}
      </td>
      <td>
        <input
          type="text"
          value={row.edited_note}
          onChange={(e) => onChange({ edited_note: e.target.value })}
          placeholder="(no note)"
          style={{
            width: "100%",
            padding: "5px 8px",
            fontSize: 11,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--surface)",
            color: "var(--text)",
          }}
        />
        {row.result && row.result !== "applied" ? (
          <div
            style={{
              marginTop: 3,
              fontSize: 10,
              color: "var(--red)",
              fontStyle: "italic",
            }}
          >
            {row.result.error}
          </div>
        ) : null}
        {row.result === "applied" ? (
          <div
            style={{
              marginTop: 3,
              fontSize: 10,
              color: "var(--green)",
              fontStyle: "italic",
            }}
          >
            applied
          </div>
        ) : null}
      </td>
      <td style={{ textAlign: "center" }}>
        <input
          type="checkbox"
          checked={row.selected}
          onChange={(e) => onChange({ selected: e.target.checked })}
          disabled={row.result === "applied"}
          aria-label="Include this row in apply"
        />
      </td>
    </tr>
  );
}
