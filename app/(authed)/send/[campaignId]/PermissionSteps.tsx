"use client";

import { useMemo, useState, useTransition } from "react";
import {
  parseApprovalReply,
  applyApprovalVerdicts,
  type ApprovalMatch,
  type UnmatchedLine,
  type Verdict,
  type VerdictInstruction,
} from "../../approval/actions";
import { emailApprovalListToAddress } from "../../approval/emailListAction";

/**
 * Permission-block sub-steps for the 9-step `/send/[campaignId]` flow.
 *
 * When `campaigns.counterpart_email` is set (multi-party campaign —
 * e.g. FishFrom with Andrew Robertson), the founder MUST obtain a
 * verdict from the counterpart before any row can be drafted or
 * queued. These three components live between Step 4 (Pick) and
 * Step 5 (Email resolution) in SendFlow.tsx.
 *
 *   4a — Send list to counterpart (emailApprovalListToAddress)
 *   4b — Paste the counterpart's reply back into the app
 *   4c — Ingest decisions (parseApprovalReply → applyApprovalVerdicts)
 *
 * Nothing in this file writes to scheduled_sends. The DB-level
 * approval gate (migration 029, enforce_scheduled_send_approval_gate)
 * still guards the final dispatch in Step 9.
 */

/* ───────────────────────── Step 4a — Send list ────────────────────────────── */

export function Step4aSendList({
  campaignId,
  counterpartEmail,
  selectedCpIds,
  onContinue,
}: {
  campaignId: string;
  counterpartEmail: string;
  selectedCpIds: string[];
  onContinue: () => void;
}) {
  const [toEmail, setToEmail] = useState<string>(counterpartEmail);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState<boolean>(false);

  function onSend() {
    setMessage(null);
    const trimmed = toEmail.trim();
    if (!trimmed) {
      setMessage("Enter the counterpart's email before sending.");
      return;
    }
    startTransition(async () => {
      const r = await emailApprovalListToAddress({
        campaignId,
        toEmail: trimmed,
      });
      if (!r.ok) {
        setMessage(`Error: ${r.error}`);
        return;
      }
      setSent(true);
      setMessage(
        `List sent to ${trimmed}. They reply inline with ok / no / flag / skip markers. Come back here when the reply lands.`,
      );
    });
  }

  return (
    <StepCard
      number="4a"
      title="Send list to counterpart for review"
      intro={`This campaign has a counterpart reviewer (${counterpartEmail}). Nothing can draft or dispatch until they've greenlit the rows. Send them the outgoing list now — they reply inline per row with ok / no / flag / skip and you paste the reply into Step 4b.`}
    >
      <div
        style={{
          padding: "10px 12px",
          background: "var(--surface-alt)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          marginBottom: 12,
          fontSize: 12,
          color: "var(--text-dim)",
          lineHeight: 1.5,
        }}
      >
        The email includes every row currently at{" "}
        <b>+0 Pending approval</b> on this campaign (server-side
        selection — matches /approval). You&rsquo;ve ticked{" "}
        <b>{selectedCpIds.length}</b> rows in Step 4; the reviewer sees
        the full pending queue so they can approve or skip anything
        waiting.
      </div>

      <label
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-dim)",
          marginBottom: 4,
        }}
      >
        Reviewer email
      </label>
      <input
        type="email"
        value={toEmail}
        onChange={(e) => setToEmail(e.target.value)}
        placeholder="andrew@fishfrom.com"
        style={{
          width: "100%",
          padding: "8px 10px",
          fontSize: 12,
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--surface)",
          color: "var(--text)",
          marginBottom: 12,
        }}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <PrimaryButton onClick={onSend} pending={isPending}>
          {isPending ? "Sending…" : sent ? "Re-send list" : "Send list for review →"}
        </PrimaryButton>
        {sent ? (
          <button type="button" onClick={onContinue} style={secondaryBtn}>
            Reply received — continue to 4b →
          </button>
        ) : null}
      </div>

      {message ? (
        <div
          style={{
            marginTop: 10,
            padding: "8px 12px",
            background: message.startsWith("Error")
              ? "var(--red-light, #fee2e2)"
              : "var(--accent-softer)",
            border: `1px solid ${
              message.startsWith("Error")
                ? "#fecaca"
                : "var(--accent)"
            }`,
            borderRadius: 6,
            fontSize: 12,
            color: message.startsWith("Error")
              ? "var(--red, #b91c1c)"
              : "var(--accent)",
            lineHeight: 1.5,
          }}
        >
          {message}
        </div>
      ) : null}
    </StepCard>
  );
}

/* ───────────────────────── Step 4b — Paste reply ──────────────────────────── */

export function Step4bPasteReply({
  campaignId: _campaignId,
  onContinue,
}: {
  campaignId: string;
  onContinue: (rawReply: string) => void;
}) {
  const [replyText, setReplyText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  function onParse() {
    const trimmed = replyText.trim();
    if (!trimmed) {
      setError("Paste the counterpart's reply first.");
      return;
    }
    if (trimmed.length > 40_000) {
      setError(
        `Reply is ${trimmed.length.toLocaleString()} chars — max 40,000. Trim the quoted history and retry.`,
      );
      return;
    }
    setError(null);
    onContinue(trimmed);
  }

  return (
    <StepCard
      number="4b"
      title="Paste the counterpart's reply"
      intro="When the reviewer replies inline with ok / no / flag / skip markers, paste the whole email body below. Step 4c then extracts each per-row verdict and, once you confirm, writes the decisions to the tracker."
    >
      <textarea
        value={replyText}
        onChange={(e) => setReplyText(e.target.value)}
        rows={14}
        spellCheck={false}
        placeholder={`Paste the reviewer's reply here — including any quoted list. Haiku parses 'ok / no / flag / skip' markers per row.

Example:
1. Regeneration.VC — ok
2. Deep Tech Seed Fund — no, already passed
3. Babel Ventures — flag, partner conflict`}
        style={{
          width: "100%",
          padding: 12,
          fontSize: 12,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          lineHeight: 1.55,
          border: "1px solid var(--border)",
          borderRadius: 8,
          resize: "vertical",
          marginBottom: 12,
          background: "var(--surface)",
          color: "var(--text)",
        }}
      />

      {error ? (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            background: "var(--red-light, #fee2e2)",
            border: "1px solid #fecaca",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--red, #b91c1c)",
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      ) : null}

      <PrimaryButton onClick={onParse}>
        Ingest decisions →
      </PrimaryButton>
    </StepCard>
  );
}

/* ───────────────────────── Step 4c — Ingest ───────────────────────────────── */

type ReviewRow = ApprovalMatch & {
  chosen_verdict: Verdict;
  edited_note: string;
  selected: boolean;
  result?: "applied" | { error: string };
};

export function Step4cIngest({
  campaignId,
  rawReply,
  onContinue,
}: {
  campaignId: string;
  rawReply: string;
  onContinue: () => void;
}) {
  const [isParsing, startParse] = useTransition();
  const [isApplying, startApply] = useTransition();
  const [hasParsed, setHasParsed] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [parseCount, setParseCount] = useState<number | null>(null);
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedLine[]>([]);
  const [applyReport, setApplyReport] = useState<
    { applied: number; failed: number } | null
  >(null);

  const selectedCount = useMemo(
    () => reviewRows.filter((r) => r.selected).length,
    [reviewRows],
  );
  const flaggedCount = useMemo(
    () => reviewRows.filter((r) => r.chosen_verdict === "maybe").length,
    [reviewRows],
  );

  function onParse() {
    setError(null);
    setApplyReport(null);
    startParse(async () => {
      const r = await parseApprovalReply({ text: rawReply, campaignId });
      if (!r.ok) {
        setError(r.error);
        setHasParsed(true);
        return;
      }
      setParseCount(r.parsed_count);
      setReviewRows(
        r.matches.map((m) => ({
          ...m,
          chosen_verdict: m.proposed_verdict,
          edited_note: m.proposed_note,
          selected: true,
        })),
      );
      setUnmatched(r.unmatched);
      setHasParsed(true);
    });
  }

  function onApply() {
    const toApply: VerdictInstruction[] = reviewRows
      .filter((r) => r.selected && r.result !== "applied")
      .map((r) => ({
        campaign_partner_id: r.campaign_partner_id,
        verdict: r.chosen_verdict,
        note: r.edited_note,
        confidence:
          r.chosen_verdict === r.proposed_verdict ? r.confidence : null,
      }));
    if (toApply.length === 0) {
      setError("Tick at least one row before applying.");
      return;
    }
    setError(null);
    startApply(async () => {
      const r = await applyApprovalVerdicts({ campaignId, verdicts: toApply });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const failedById = new Map<string, string>(
        r.failed.map((f) => [f.campaign_partner_id, f.error]),
      );
      setReviewRows((rows) =>
        rows.map((row) => {
          if (!row.selected) return row;
          const failure = failedById.get(row.campaign_partner_id);
          return {
            ...row,
            result: failure ? { error: failure } : "applied",
          };
        }),
      );
      setApplyReport({ applied: r.applied, failed: r.failed.length });
    });
  }

  function updateRow(index: number, patch: Partial<ReviewRow>) {
    setReviewRows((rows) =>
      rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }

  const canContinue = applyReport !== null && applyReport.applied > 0;

  return (
    <StepCard
      number="4c"
      title="Ingest decisions"
      intro="Haiku reads the pasted reply and proposes a verdict per row. Review the table — especially any flagged rows — then apply. Only approved (+1) rows progress to drafting. Nothing is written until you hit Apply."
    >
      {!hasParsed ? (
        <PrimaryButton onClick={onParse} pending={isParsing}>
          {isParsing ? "Parsing with Haiku…" : "Parse reply with Haiku →"}
        </PrimaryButton>
      ) : null}

      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: "8px 12px",
            background: "var(--red-light, #fee2e2)",
            border: "1px solid #fecaca",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--red, #b91c1c)",
            lineHeight: 1.5,
          }}
        >
          {error}
        </div>
      ) : null}

      {hasParsed && parseCount !== null && !error ? (
        <div
          style={{
            marginTop: 12,
            padding: "8px 12px",
            background: "var(--surface-alt)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--text-dim)",
            lineHeight: 1.5,
          }}
        >
          Haiku extracted <b style={{ color: "var(--text)" }}>{parseCount}</b>{" "}
          decision{parseCount === 1 ? "" : "s"} ·{" "}
          <b style={{ color: "var(--text)" }}>{reviewRows.length}</b> matched
          to this campaign&rsquo;s pool ·{" "}
          <b style={{ color: "var(--text)" }}>{unmatched.length}</b>{" "}
          unmatched.
          {flaggedCount > 0 ? (
            <>
              {" "}
              <b style={{ color: "var(--amber, #b45309)" }}>
                {flaggedCount} flagged — review before applying.
              </b>
            </>
          ) : null}
        </div>
      ) : null}

      {/* Flagged callout — pulled up above the table so Tristan sees it. */}
      {flaggedCount > 0 ? (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            background: "var(--amber-light, #fef3c7)",
            border: "1px solid #fde68a",
            borderRadius: 6,
            fontSize: 12,
            color: "#78350f",
            lineHeight: 1.5,
          }}
        >
          <b>Flagged rows need review:</b>
          <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
            {reviewRows
              .filter((r) => r.chosen_verdict === "maybe")
              .map((r) => (
                <li key={r.campaign_partner_id}>
                  <b>{r.firm_name ?? r.reply_name}</b>
                  {r.edited_note ? ` — ${r.edited_note}` : ""}
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {reviewRows.length > 0 ? (
        <div
          style={{
            marginTop: 12,
            maxHeight: 420,
            overflowY: "auto",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          {reviewRows.map((row, idx) => (
            <IngestRow
              key={row.campaign_partner_id}
              row={row}
              onChange={(patch) => updateRow(idx, patch)}
            />
          ))}
        </div>
      ) : null}

      {unmatched.length > 0 ? (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            background: "var(--amber-light, #fef3c7)",
            border: "1px solid #fde68a",
            borderRadius: 6,
            fontSize: 12,
            color: "#78350f",
            lineHeight: 1.5,
          }}
        >
          <b>
            {unmatched.length} name{unmatched.length === 1 ? "" : "s"} couldn
            &rsquo;t be matched to this campaign&rsquo;s pool:
          </b>
          <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
            {unmatched.map((u, i) => (
              <li key={`${u.reply_name}-${i}`}>
                <b>{u.reply_name}</b> → {u.verdict}
                {u.note ? `, ${u.note}` : ""} ·{" "}
                {u.reason === "ambiguous"
                  ? "multiple candidates in pool"
                  : "no candidate in pool"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {applyReport ? (
        <div
          style={{
            marginTop: 10,
            padding: "8px 12px",
            background: "var(--green-light, #dcfce7)",
            border: "1px solid #bbf7d0",
            borderRadius: 6,
            fontSize: 12,
            color: "#065f46",
            lineHeight: 1.5,
          }}
        >
          Applied <b>{applyReport.applied}</b> verdict
          {applyReport.applied === 1 ? "" : "s"} to campaign_partners.
          {applyReport.failed > 0 ? (
            <>
              {" "}
              <b>{applyReport.failed}</b> row
              {applyReport.failed === 1 ? "" : "s"} failed — see inline
              notes.
            </>
          ) : null}
        </div>
      ) : null}

      {hasParsed && reviewRows.length > 0 ? (
        <div
          style={{
            marginTop: 14,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <PrimaryButton onClick={onApply} pending={isApplying}>
            {isApplying
              ? "Applying…"
              : `Apply ${selectedCount} verdict${selectedCount === 1 ? "" : "s"} →`}
          </PrimaryButton>
          {canContinue ? (
            <button type="button" onClick={onContinue} style={secondaryBtn}>
              Continue to email resolution →
            </button>
          ) : (
            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
              Apply verdicts before continuing.
            </span>
          )}
        </div>
      ) : null}
    </StepCard>
  );
}

/* ───────────────────────── Ingest row ─────────────────────────────────────── */

function IngestRow({
  row,
  onChange,
}: {
  row: ReviewRow;
  onChange: (patch: Partial<ReviewRow>) => void;
}) {
  const verdictOptions: Array<{ value: Verdict; label: string }> = [
    { value: "ok", label: "Approve → +1" },
    { value: "not_for_me", label: "Reject → −3" },
    { value: "skip", label: "Skip → −3" },
    { value: "maybe", label: "Flag → +0" },
  ];
  const applied = row.result === "applied";
  const failed =
    row.result && typeof row.result === "object" ? row.result.error : null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto auto",
        gap: 10,
        padding: "10px 12px",
        borderBottom: "1px solid var(--border-soft, var(--border))",
        background: applied
          ? "var(--green-light, #dcfce7)"
          : row.selected
            ? "var(--surface)"
            : "var(--surface-alt)",
        alignItems: "center",
      }}
    >
      <input
        type="checkbox"
        checked={row.selected}
        onChange={(e) => onChange({ selected: e.target.checked })}
        disabled={applied}
        aria-label="Include this row in apply"
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>
          {row.firm_name ?? row.reply_name}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>
          {row.reply_name !== row.firm_name ? (
            <>
              reply: <b>{row.reply_name}</b> ·{" "}
              {row.match_reason.replace("_", " ")}
            </>
          ) : (
            <>matched exactly</>
          )}
          {" · now "}
          {row.current_status_code ?? "—"}
          {row.current_status_label ? ` ${row.current_status_label}` : ""}
        </div>
        <input
          type="text"
          value={row.edited_note}
          onChange={(e) => onChange({ edited_note: e.target.value })}
          placeholder="(no note)"
          disabled={applied}
          style={{
            marginTop: 4,
            width: "100%",
            padding: "4px 6px",
            fontSize: 11,
            border: "1px solid var(--border)",
            borderRadius: 4,
            background: applied ? "transparent" : "var(--surface)",
          }}
        />
        {failed ? (
          <div
            style={{
              marginTop: 3,
              fontSize: 10,
              color: "var(--red, #b91c1c)",
              fontStyle: "italic",
            }}
          >
            {failed}
          </div>
        ) : null}
      </div>
      <select
        value={row.chosen_verdict}
        onChange={(e) =>
          onChange({ chosen_verdict: e.target.value as Verdict })
        }
        disabled={applied}
        style={{
          padding: "4px 6px",
          fontSize: 11,
          border: "1px solid var(--border)",
          borderRadius: 4,
          background: "var(--surface)",
        }}
      >
        {verdictOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ConfidenceBadge confidence={row.confidence} />
    </div>
  );
}

/* ───────────────────────── Confidence badge ───────────────────────────────── */

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null || !Number.isFinite(confidence)) {
    return (
      <span style={confidenceStyle("var(--surface-alt)", "var(--text-dim)", "var(--border)")}>
        no score
      </span>
    );
  }
  const pct = Math.round(confidence * 100);
  if (confidence >= 0.85) {
    return (
      <span
        style={confidenceStyle("var(--green-light, #dcfce7)", "var(--green, #047857)", "#bbf7d0")}
      >
        {pct}%
      </span>
    );
  }
  if (confidence >= 0.6) {
    return (
      <span
        style={confidenceStyle("var(--amber-light, #fef3c7)", "var(--amber, #b45309)", "#fde68a")}
      >
        {pct}% · review
      </span>
    );
  }
  return (
    <span
      style={confidenceStyle("var(--red-light, #fee2e2)", "var(--red, #b91c1c)", "#fecaca")}
    >
      {pct}% · confirm
    </span>
  );
}

function confidenceStyle(
  bg: string,
  fg: string,
  border: string,
): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 600,
    padding: "2px 6px",
    borderRadius: 10,
    background: bg,
    color: fg,
    border: `1px solid ${border}`,
    whiteSpace: "nowrap",
  };
}

/* ───────────────────────── Shared chrome ──────────────────────────────────── */

function StepCard({
  number,
  title,
  intro,
  children,
}: {
  number: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: 20,
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--accent)",
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          Step {number}
        </span>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</h3>
      </div>
      <p
        style={{
          margin: "0 0 16px 0",
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--text-dim)",
        }}
      >
        {intro}
      </p>
      {children}
    </div>
  );
}

function PrimaryButton({
  onClick,
  children,
  pending,
}: {
  onClick: () => void;
  children: React.ReactNode;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      style={{
        padding: "8px 16px",
        fontSize: 13,
        fontWeight: 600,
        color: "white",
        background: pending ? "var(--accent-softer)" : "var(--accent)",
        border: "none",
        borderRadius: 6,
        cursor: pending ? "wait" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

const secondaryBtn: React.CSSProperties = {
  padding: "7px 14px",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--text-dim)",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  cursor: "pointer",
};
