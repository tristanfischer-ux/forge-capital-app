"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { markFollowUpDone } from "../partner/[id]/logInteractionAction";

export function FollowUpRow(props: {
  contactEventId: string;
  firmName: string | null;
  firmId: number | null;
  partnerId: number | null;
  partnerName: string | null;
  partnerTitle: string | null;
  campaignName: string | null;
  statusCode: string | null;
  statusLabel: string | null;
  eventType: string | null;
  eventAt: string;
  dueAt: string;
  title: string | null;
  notes: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onMarkDone() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const out = await markFollowUpDone(props.contactEventId);
      if (out.ok) setDone(true);
      else setError(out.error);
    });
  }

  if (done) {
    return (
      <li
        style={{
          fontSize: 11,
          color: "var(--green)",
          padding: "6px 12px",
          border: "1px solid var(--green)",
          background: "var(--green-light)",
          borderRadius: 6,
        }}
      >
        ✓ Marked done — {props.firmName ?? "row"}
      </li>
    );
  }

  const due = new Date(props.dueAt);
  const now = new Date();
  const diffDays = Math.round(
    (due.getTime() - now.getTime()) / 86_400_000,
  );
  const relativeDue =
    diffDays < 0
      ? `${-diffDays}d overdue`
      : diffDays === 0
        ? "today"
        : diffDays === 1
          ? "tomorrow"
          : `in ${diffDays}d`;
  const absoluteDue = due.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  const originalEventDate = new Date(props.eventAt).toLocaleDateString(
    "en-GB",
    { day: "numeric", month: "short" },
  );

  return (
    <li
      style={{
        padding: "10px 14px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--surface)",
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14, color: "var(--text)" }}>
            {props.firmId ? (
              <Link
                href={`/investor/${props.firmId}`}
                style={{ color: "var(--accent)", textDecoration: "none" }}
              >
                {props.firmName ?? "—"}
              </Link>
            ) : (
              props.firmName ?? "—"
            )}
          </strong>
          {props.partnerName ? (
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
              ·{" "}
              {props.partnerId ? (
                <Link
                  href={`/partner/${props.partnerId}`}
                  style={{ color: "var(--accent)", textDecoration: "none" }}
                >
                  {props.partnerName}
                </Link>
              ) : (
                props.partnerName
              )}
              {props.partnerTitle ? (
                <span style={{ color: "var(--text-faint)" }}>
                  {" "}
                  · {props.partnerTitle}
                </span>
              ) : null}
            </span>
          ) : null}
          {props.statusCode ? (
            <span
              style={{
                fontSize: 10,
                padding: "1px 6px",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: "var(--text-dim)",
              }}
              title={props.statusLabel ?? undefined}
            >
              {props.statusCode}
            </span>
          ) : null}
        </div>
        <div style={{ marginTop: 4, fontSize: 12, color: "var(--text)" }}>
          {props.title ?? "(no title)"}
        </div>
        {props.notes ? (
          <div
            style={{
              marginTop: 4,
              fontSize: 11,
              color: "var(--text-dim)",
              whiteSpace: "pre-wrap",
              maxHeight: 60,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {props.notes.length > 220
              ? props.notes.slice(0, 217) + "…"
              : props.notes}
          </div>
        ) : null}
        <div
          style={{
            marginTop: 6,
            fontSize: 10,
            color: "var(--text-faint)",
          }}
        >
          {props.eventType ? (
            <span style={{ marginRight: 8 }}>
              {props.eventType.replace(/_/g, " ")}
            </span>
          ) : null}
          {props.campaignName ? (
            <span style={{ marginRight: 8 }}>
              · {props.campaignName}
            </span>
          ) : null}
          <span>
            · logged {originalEventDate}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
          {relativeDue}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-dim)" }}>
          {absoluteDue}
        </div>
        <button
          type="button"
          onClick={onMarkDone}
          disabled={isPending}
          style={{
            marginTop: 4,
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 500,
            border: "1px solid var(--border)",
            background: "var(--surface-alt)",
            color: "var(--text-dim)",
            borderRadius: 4,
            cursor: isPending ? "wait" : "pointer",
          }}
        >
          {isPending ? "…" : "Mark done"}
        </button>
        {error ? (
          <span style={{ fontSize: 10, color: "var(--red)" }}>{error}</span>
        ) : null}
      </div>
    </li>
  );
}
