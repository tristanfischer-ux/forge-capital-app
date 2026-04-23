"use client";

import { useState, useTransition } from "react";
import {
  classifyAndDraftResponse,
  sendResponseAndUpdateStatus,
  type Sentiment,
  type TestReplyRow,
} from "./actions";

export function RepliesPanel(props: {
  rows: TestReplyRow[];
  userEmail: string | null;
}) {
  const rowsWithReply = props.rows.filter((r) => r.replyBody);
  const rowsWithoutReply = props.rows.filter((r) => !r.replyBody);

  return (
    <div className="space-y-5">
      <section className="rounded-[10px] border border-border bg-surface p-5 shadow-[var(--shadow)]">
        <h2 className="mb-3 text-[14px] font-semibold text-text">
          Replies received ({rowsWithReply.length})
        </h2>
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
