"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  classifyAndDraftResponse,
  sendResponseAndUpdateStatus,
  emailResponseSheet,
  dispatchApprovedResponses,
  type Sentiment,
  type TestReplyRow,
  type DispatchRowOutcome,
} from "./actions";

export function RepliesPanel(props: {
  rows: TestReplyRow[];
  userEmail: string | null;
  campaignId: string;
}) {
  const rowsWithReply = props.rows.filter((r) => r.replyBody);
  const rowsWithoutReply = props.rows.filter((r) => !r.replyBody);
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [lastChecked, setLastChecked] = useState<string>(() =>
    new Date().toISOString().slice(11, 19),
  );

  function onRefresh() {
    if (isRefreshing) return;
    startRefresh(() => {
      router.refresh();
      setLastChecked(new Date().toISOString().slice(11, 19));
    });
  }

  return (
    <div className="space-y-5">
      <SpreadsheetApprovalCard
        campaignId={props.campaignId}
        hasReplies={rowsWithReply.length > 0}
      />

      <section className="rounded-[10px] border border-border bg-surface p-5 shadow-[var(--shadow)]">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-[14px] font-semibold text-text">
            Replies received ({rowsWithReply.length})
          </h2>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            style={{
              fontSize: 11,
              padding: "4px 10px",
              border: "1px solid var(--accent)",
              background: "var(--accent-softer)",
              color: "var(--accent)",
              borderRadius: 4,
              fontWeight: 600,
              cursor: isRefreshing ? "wait" : "pointer",
            }}
            title="Re-reads every [TEST] thread on Gmail for new inbound messages."
          >
            {isRefreshing ? "Checking Gmail…" : "Check for new replies"}
          </button>
          <span
            style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: "auto" }}
          >
            Last checked {lastChecked} UTC
          </span>
        </div>
        {rowsWithReply.length === 0 ? (
          <p className="text-[13px] text-text-dim">
            No replies yet. When {props.userEmail ?? "the test address"}{" "}
            receives a reply to any [TEST] dispatch, it will appear here.
          </p>
        ) : (
          <ul className="space-y-4">
            {rowsWithReply.map((row) => (
              <ReplyRow key={row.campaignPartnerId} row={row} />
            ))}
          </ul>
        )}
      </section>

      {rowsWithoutReply.length > 0 ? (
        <section className="rounded-[10px] border border-dashed border-border bg-surface-alt p-5 text-[12px] text-text-dim">
          <b className="text-text">Still awaiting</b>: {rowsWithoutReply.length}{" "}
          thread{rowsWithoutReply.length === 1 ? "" : "s"} with no inbound
          reply yet —
          <span className="ml-1">
            {rowsWithoutReply.map((r) => r.firmName).filter(Boolean).join(", ")}
          </span>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Spreadsheet-style approval card — replaces the per-row click UX
 * that Tristan flagged 2026-04-23 as clunky. Two-step flow:
 *
 *   Step 1 — "Email response sheet to me"
 *       Fires emailResponseSheet which composes a numbered list of
 *       every inbound reply with Opus-classified sentiment + drafted
 *       response, then dispatches it as a plain-text email to
 *       tristan.fischer@mac.com. Founder reviews on phone, replies
 *       with y / no / edit per row.
 *
 *   Step 2 — paste founder's reply + Dispatch approved
 *       dispatchApprovedResponses uses Opus to parse per-row decisions
 *       out of the free-form reply, then dispatches each approved
 *       response via Gmail + transitions the tracker status.
 */
function SpreadsheetApprovalCard(props: {
  campaignId: string;
  hasReplies: boolean;
}) {
  const [toEmail, setToEmail] = useState("tristan.fischer@mac.com");
  const [approvedText, setApprovedText] = useState("");
  const [isPending, startTransition] = useTransition();
  const [emailState, setEmailState] = useState<
    | { kind: "idle" }
    | { kind: "sent"; rowCount: number; threadId: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [dispatchState, setDispatchState] = useState<
    | { kind: "idle" }
    | {
        kind: "done";
        sent: number;
        skipped: number;
        failed: number;
        rows: DispatchRowOutcome[];
      }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  function onEmailSheet() {
    if (isPending) return;
    setEmailState({ kind: "idle" });
    startTransition(async () => {
      const out = await emailResponseSheet({
        campaignId: props.campaignId,
        toEmail: toEmail.trim(),
      });
      if (out.ok) {
        setEmailState({
          kind: "sent",
          rowCount: out.rowCount,
          threadId: out.threadId,
        });
      } else {
        setEmailState({ kind: "error", message: out.error });
      }
    });
  }

  function onDispatch() {
    if (isPending) return;
    setDispatchState({ kind: "idle" });
    startTransition(async () => {
      const out = await dispatchApprovedResponses({
        campaignId: props.campaignId,
        approvedText: approvedText.trim(),
      });
      if (out.ok) {
        setDispatchState({
          kind: "done",
          sent: out.sent,
          skipped: out.skipped,
          failed: out.failed,
          rows: out.rows,
        });
      } else {
        setDispatchState({ kind: "error", message: out.error });
      }
    });
  }

  return (
    <section className="rounded-[10px] border border-accent bg-accent-softer p-5 shadow-[var(--shadow)]">
      <h2 className="mb-2 text-[14px] font-semibold text-text">
        Spreadsheet-style approval
      </h2>
      <p className="mb-4 text-[12px] leading-relaxed text-text-dim">
        Instead of clicking Send on each row below, receive a single
        email with every reply + sentiment + drafted response as a
        numbered list. Approve from your phone by replying with{" "}
        <code>y / no / edit</code> per row. Paste your reply here, the
        app parses it and dispatches all approved responses in one shot.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="block text-[10px] font-medium uppercase tracking-wide text-text-dim">
            Step 1 — email the sheet to
          </span>
          <input
            type="email"
            value={toEmail}
            onChange={(e) => setToEmail(e.target.value)}
            disabled={isPending || !props.hasReplies}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            className="btn primary w-full md:w-auto"
            onClick={onEmailSheet}
            disabled={isPending || !props.hasReplies || !toEmail.includes("@")}
            style={{
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              background: "var(--accent)",
              borderColor: "var(--accent)",
              color: "#fff",
            }}
          >
            {isPending && emailState.kind === "idle"
              ? "Generating sheet…"
              : "Email response sheet →"}
          </button>
        </div>
      </div>

      {emailState.kind === "sent" ? (
        <div className="mt-2 text-[11px] text-[var(--green)]">
          ✓ Sent {emailState.rowCount} rows to {toEmail}.{" "}
          <a
            href={`https://mail.google.com/mail/u/0/#sent/${emailState.threadId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            open in Gmail ↗
          </a>
        </div>
      ) : null}
      {emailState.kind === "error" ? (
        <div className="mt-2 text-[11px] text-[var(--red)]">
          {emailState.message}
        </div>
      ) : null}

      {/* Step 2 — paste reply */}
      <div className="mt-5 border-t border-accent pt-4">
        <span className="block text-[10px] font-medium uppercase tracking-wide text-text-dim">
          Step 2 — paste your approved-sheet reply
        </span>
        <textarea
          value={approvedText}
          onChange={(e) => setApprovedText(e.target.value)}
          disabled={isPending}
          rows={8}
          placeholder="Paste your reply email here. Any row marked 'y' will be dispatched; 'no' rows skipped; 'edit: …' rows use your replacement text."
          className="mt-1 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-[13px] leading-relaxed text-text outline-none focus:border-accent"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn primary"
            onClick={onDispatch}
            disabled={isPending || !approvedText.trim()}
            style={{
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              background: "var(--green)",
              borderColor: "var(--green)",
              color: "#fff",
            }}
          >
            {isPending && dispatchState.kind === "idle"
              ? "Parsing + dispatching…"
              : "Dispatch approved responses →"}
          </button>
        </div>

        {dispatchState.kind === "error" ? (
          <div className="mt-3 rounded-md border border-red bg-red-light px-3 py-2 text-[12px] text-red">
            {dispatchState.message}
          </div>
        ) : null}

        {dispatchState.kind === "done" ? (
          <div className="mt-3 rounded-md border border-green bg-green-light p-3">
            <div className="text-[13px] font-semibold text-green">
              ✓ Dispatched {dispatchState.sent} · Skipped{" "}
              {dispatchState.skipped} · Failed {dispatchState.failed}
            </div>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-[11px]">
              {dispatchState.rows.map((r) => (
                <li key={r.campaignPartnerId}>
                  <span
                    style={{
                      color: r.ok ? "var(--green)" : "var(--red)",
                      fontWeight: 700,
                    }}
                  >
                    {r.ok ? "✓" : "✗"}{" "}
                  </span>
                  <b>{r.firmName ?? "—"}</b>{" "}
                  <span className="text-text-dim">
                    · {r.decision} · {r.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ReplyRow({ row }: { row: TestReplyRow }) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<
    | {
        kind: "idle";
        sentiment: Sentiment | null;
        reasons: string[];
        draft: string | null;
      }
    | { kind: "error"; message: string }
    | { kind: "sent"; newStatus: string }
  >({
    kind: "idle",
    sentiment: row.cachedSentiment,
    reasons: [],
    draft: row.cachedDraftResponse,
  });

  function onClassify() {
    if (isPending || !row.replyBody) return;
    startTransition(async () => {
      const out = await classifyAndDraftResponse({
        campaignPartnerId: row.campaignPartnerId,
        replyBody: row.replyBody as string,
      });
      if (out.ok) {
        setState({
          kind: "idle",
          sentiment: out.sentiment,
          reasons: out.reasons,
          draft: out.draftResponse,
        });
      } else {
        setState({ kind: "error", message: out.error });
      }
    });
  }

  function onSendResponse() {
    if (isPending) return;
    if (state.kind !== "idle" || !state.draft || !state.sentiment) return;
    if (!row.partnerEmail) {
      setState({
        kind: "error",
        message: "No partner email on file — cannot send response.",
      });
      return;
    }
    const subject = row.outboundSubject?.startsWith("[TEST]")
      ? `Re: ${row.outboundSubject}`
      : `Re: ${row.outboundSubject ?? "our outreach"}`;
    startTransition(async () => {
      const out = await sendResponseAndUpdateStatus({
        campaignPartnerId: row.campaignPartnerId,
        toEmail: row.partnerEmail as string,
        subject,
        body: state.draft as string,
        sentiment: state.sentiment as Sentiment,
        gmailThreadId: row.gmailThreadId,
      });
      if (out.ok) {
        setState({ kind: "sent", newStatus: out.newStatusCode });
      } else {
        setState({ kind: "error", message: out.error });
      }
    });
  }

  const sentimentColour =
    state.kind === "idle" && state.sentiment === "positive"
      ? "var(--green)"
      : state.kind === "idle" && state.sentiment === "negative"
        ? "var(--red)"
        : state.kind === "idle" && state.sentiment === "neutral"
          ? "var(--amber)"
          : "var(--text-dim)";

  return (
    <li className="rounded-[8px] border border-border bg-surface-alt p-4">
      <header className="flex flex-wrap items-center gap-2">
        <strong className="text-[14px] text-text">{row.firmName ?? "—"}</strong>
        {row.partnerName ? (
          <span className="text-[12px] text-text-dim">
            · {row.partnerName}
          </span>
        ) : null}
        <span className="ml-auto text-[11px] text-text-faint">
          {row.statusCode ? `Current: ${row.statusCode}` : null}
        </span>
      </header>

      <div className="mt-2 rounded border border-border-soft bg-surface p-3 text-[13px] leading-relaxed text-text">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-dim">
          Reply from {row.replyFrom ?? "unknown"}
        </div>
        <div className="whitespace-pre-wrap">{row.replyBody}</div>
      </div>

      {state.kind === "idle" && !state.sentiment ? (
        <button
          type="button"
          className="btn sm primary mt-3"
          onClick={onClassify}
          disabled={isPending}
          style={{
            fontSize: 12,
            padding: "6px 12px",
            background: "var(--accent)",
            borderColor: "var(--accent)",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          {isPending ? "Classifying with Opus…" : "Classify + draft response"}
        </button>
      ) : null}

      {state.kind === "idle" && state.sentiment ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
            <span
              style={{
                color: sentimentColour,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.6px",
                fontSize: 11,
              }}
            >
              {state.sentiment}
            </span>
            {state.reasons.length > 0 ? (
              <span className="text-text-dim">
                · {state.reasons.join(" · ")}
              </span>
            ) : null}
            <button
              type="button"
              className="ml-auto"
              onClick={onClassify}
              disabled={isPending}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                border: "1px solid var(--border)",
                background: "var(--surface)",
                borderRadius: 4,
                color: "var(--text-dim)",
              }}
            >
              Re-classify
            </button>
          </div>

          <div className="mt-3 rounded border border-border-soft bg-surface p-3">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-dim">
              Drafted response
            </div>
            <textarea
              value={state.draft ?? ""}
              onChange={(e) =>
                setState({
                  ...state,
                  draft: e.target.value,
                })
              }
              rows={6}
              className="w-full resize-y rounded border border-border bg-surface-alt p-2 text-[13px] leading-relaxed text-text focus:border-accent focus:outline-none"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn sm primary"
                onClick={onSendResponse}
                disabled={isPending || !row.partnerEmail}
                style={{
                  fontSize: 12,
                  padding: "6px 12px",
                  background: "var(--green)",
                  borderColor: "var(--green)",
                  color: "#fff",
                  fontWeight: 600,
                }}
                title={
                  row.partnerEmail
                    ? `Dispatches to ${row.partnerEmail} and transitions the tracker row.`
                    : "No partner email on file."
                }
              >
                {isPending
                  ? "Sending…"
                  : `Send response + transition status (${
                      state.sentiment === "positive"
                        ? "+7"
                        : state.sentiment === "negative"
                          ? "-1"
                          : "+5"
                    })`}
              </button>
              {!row.partnerEmail ? (
                <span className="text-[11px] text-red">
                  No partner email on file.
                </span>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {state.kind === "error" ? (
        <div className="mt-3 rounded border border-red bg-red-light p-2 text-[12px] text-red">
          {state.message}
        </div>
      ) : null}

      {state.kind === "sent" ? (
        <div className="mt-3 rounded border border-green bg-green-light p-2 text-[12px] text-green">
          ✓ Response sent. Status advanced to{" "}
          <code>{state.newStatus}</code>.
        </div>
      ) : null}
    </li>
  );
}
