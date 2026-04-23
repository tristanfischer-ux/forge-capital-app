"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelScheduledSend } from "../schedule-send/actions";

interface QueueRow {
  id: string;
  firm_name: string | null;
  partner_name: string | null;
  to_email: string;
  subject: string;
  scheduled_for_utc: string;
  status: "pending" | "dispatching" | "sent" | "failed" | "cancelled";
  sent_at: string | null;
  error_message: string | null;
  gmail_thread_id: string | null;
}

/**
 * Queue monitor client component.
 *
 * - Groups rows by status and renders one table per bucket.
 * - Converts `scheduled_for_utc` to the viewer's local time for
 *   readability.
 * - Cancel button on pending rows — calls the server action, then
 *   router.refresh() to pull the updated status.
 * - Auto-refresh every 30s so new dispatches surface without a manual
 *   reload.
 */
export function ScheduledQueueClient(props: { rows: QueueRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lastAction, setLastAction] = useState<
    | { kind: "idle" }
    | { kind: "cancelled"; id: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  // Auto-refresh every 30s. Tristan uses this page as a live monitor
  // during the morning send window — a new row flipping pending →
  // dispatching → sent should appear without Cmd-R.
  useEffect(() => {
    const handle = setInterval(() => {
      router.refresh();
    }, 30_000);
    return () => clearInterval(handle);
  }, [router]);

  function onCancel(id: string) {
    if (isPending) return;
    setLastAction({ kind: "idle" });
    startTransition(async () => {
      const out = await cancelScheduledSend(id);
      if (out.ok) {
        setLastAction({ kind: "cancelled", id });
        router.refresh();
      } else {
        setLastAction({ kind: "error", message: out.error });
      }
    });
  }

  const buckets: Array<{
    title: string;
    status: QueueRow["status"];
    tone: "accent" | "amber" | "green" | "red" | "dim";
  }> = [
    { title: "Pending", status: "pending", tone: "accent" },
    { title: "Dispatching", status: "dispatching", tone: "amber" },
    { title: "Sent", status: "sent", tone: "green" },
    { title: "Failed", status: "failed", tone: "red" },
    { title: "Cancelled", status: "cancelled", tone: "dim" },
  ];

  return (
    <div className="space-y-6">
      {lastAction.kind === "error" ? (
        <div
          className="rounded-md border border-border-soft bg-surface-alt p-3 text-[12px]"
          style={{ color: "var(--red)" }}
        >
          Cancel failed: {lastAction.message}
        </div>
      ) : null}

      {buckets.map((bucket) => {
        const rows = props.rows.filter((r) => r.status === bucket.status);
        if (rows.length === 0) {
          return (
            <section
              key={bucket.status}
              className="rounded-[10px] border border-border bg-surface p-4 shadow-[var(--shadow)]"
            >
              <h2 className="mb-2 text-[13px] font-semibold text-text">
                {bucket.title}{" "}
                <span className="text-text-dim">({rows.length})</span>
              </h2>
              <p className="text-[12px] text-text-dim">
                {emptyCopy(bucket.status)}
              </p>
            </section>
          );
        }
        return (
          <section
            key={bucket.status}
            className="rounded-[10px] border border-border bg-surface p-4 shadow-[var(--shadow)]"
          >
            <h2 className="mb-3 text-[13px] font-semibold text-text">
              {bucket.title}{" "}
              <span className="text-text-dim">({rows.length})</span>
            </h2>
            <ul className="divide-y divide-[var(--border-soft)]">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-start gap-3 py-2 text-[12px]"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-text">
                      {row.firm_name ?? "—"}
                      {row.partner_name ? (
                        <span className="text-text-dim">
                          {" "}
                          · {row.partner_name}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-text-dim">
                      {row.to_email}
                    </div>
                    <div className="mt-0.5 text-text-dim">
                      Subject: {row.subject.slice(0, 120)}
                    </div>
                    {row.error_message ? (
                      <div
                        className="mt-1"
                        style={{ color: "var(--red)" }}
                      >
                        {row.error_message.slice(0, 400)}
                      </div>
                    ) : null}
                  </div>
                  <div className="min-w-[140px] text-right text-text-dim">
                    <div title={row.scheduled_for_utc}>
                      {formatLocalTime(row.scheduled_for_utc)}
                    </div>
                    {row.sent_at ? (
                      <div
                        className="mt-0.5 text-[11px]"
                        style={{ color: "var(--green)" }}
                      >
                        sent {formatLocalTime(row.sent_at)}
                      </div>
                    ) : null}
                    {row.status === "pending" ? (
                      <button
                        type="button"
                        onClick={() => onCancel(row.id)}
                        disabled={isPending}
                        className="btn mt-1"
                        style={{
                          padding: "4px 10px",
                          fontSize: 11,
                          background: "transparent",
                          border: "1px solid var(--border)",
                          color: "var(--text)",
                        }}
                      >
                        Cancel
                      </button>
                    ) : null}
                    {row.status === "sent" && row.gmail_thread_id ? (
                      <a
                        href={`https://mail.google.com/mail/u/0/#sent/${row.gmail_thread_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-accent hover:text-accent-dark"
                        style={{ fontSize: 11 }}
                      >
                        open in Gmail ↗
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function formatLocalTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function emptyCopy(status: QueueRow["status"]): string {
  switch (status) {
    case "pending":
      return "No pending rows — nothing is waiting to dispatch. Queue a batch from /approval/schedule-send.";
    case "dispatching":
      return "No rows currently dispatching — the daemon is idle.";
    case "sent":
      return "No successful sends yet — will populate once the daemon dispatches its first row.";
    case "failed":
      return "No failed rows — clean run.";
    case "cancelled":
      return "No cancelled rows.";
  }
}
