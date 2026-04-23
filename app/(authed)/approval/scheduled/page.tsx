import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { ScheduledQueueClient } from "./ScheduledQueueClient";

/**
 * Scheduled queue monitor. Lists `scheduled_sends` rows grouped by
 * status (pending / dispatching / sent / failed / cancelled), shows
 * the scheduled UTC instant, and offers a Cancel button on pending
 * rows.
 *
 * Auto-refreshes every 30 seconds via a client-side `router.refresh`
 * ping so new dispatches are visible without a manual reload. The
 * client component handles that; this server component fetches the
 * latest rows on every render.
 *
 * Design doc: docs/design-scheduled-sends.md §UI.
 */
export const dynamic = "force-dynamic";

interface ScheduledRow {
  id: string;
  campaign_partner_id: string;
  to_email: string;
  subject: string;
  scheduled_for_utc: string;
  status: "pending" | "dispatching" | "sent" | "failed" | "cancelled";
  sent_at: string | null;
  error_message: string | null;
  gmail_thread_id: string | null;
  campaign_partners: {
    campaign_id: string;
    partners_mirror: {
      name: string | null;
      investors_mirror: {
        firm_name: string | null;
      } | null;
    } | null;
  } | null;
}

async function loadScheduledSends(): Promise<ScheduledRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("scheduled_sends")
    .select(
      `
      id,
      campaign_partner_id,
      to_email,
      subject,
      scheduled_for_utc,
      status,
      sent_at,
      error_message,
      gmail_thread_id,
      campaign_partners:campaign_partner_id (
        campaign_id,
        partners_mirror:partner_id (
          name,
          investors_mirror:investor_id (
            firm_name
          )
        )
      )
      `,
    )
    .order("scheduled_for_utc", { ascending: true })
    .limit(500);

  if (error) {
    console.error("loadScheduledSends failed:", error.message);
    return [];
  }
  return (data ?? []) as unknown as ScheduledRow[];
}

export default async function ScheduledQueuePage() {
  const rows = await loadScheduledSends();

  const byStatus = {
    pending: rows.filter((r) => r.status === "pending"),
    dispatching: rows.filter((r) => r.status === "dispatching"),
    sent: rows.filter((r) => r.status === "sent"),
    failed: rows.filter((r) => r.status === "failed"),
    cancelled: rows.filter((r) => r.status === "cancelled"),
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-4 text-[12px] text-text-dim">
        <Link
          href="/approval"
          className="text-accent underline decoration-dotted underline-offset-2 hover:text-accent-dark"
        >
          &larr; Back to approval
        </Link>
        {" · "}
        <Link
          href="/approval/schedule-send"
          className="text-accent underline decoration-dotted underline-offset-2 hover:text-accent-dark"
        >
          Queue a batch &rarr;
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="text-[22px] font-bold tracking-[-0.01em] text-text">
          Scheduled queue
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-text-dim">
          Rows waiting to dispatch through the scheduled-sends daemon.
          Pending rows fire when{" "}
          <code>scheduled_for_utc &le; now()</code>. Auto-refreshes every
          30&nbsp;seconds.
        </p>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <StatTile label="Pending" count={byStatus.pending.length} tone="accent" />
        <StatTile
          label="Dispatching"
          count={byStatus.dispatching.length}
          tone="amber"
        />
        <StatTile label="Sent" count={byStatus.sent.length} tone="green" />
        <StatTile label="Failed" count={byStatus.failed.length} tone="red" />
        <StatTile
          label="Cancelled"
          count={byStatus.cancelled.length}
          tone="dim"
        />
      </section>

      <ScheduledQueueClient
        rows={rows.map((r) => ({
          id: r.id,
          firm_name:
            r.campaign_partners?.partners_mirror?.investors_mirror?.firm_name ??
            null,
          partner_name: r.campaign_partners?.partners_mirror?.name ?? null,
          to_email: r.to_email,
          subject: r.subject,
          scheduled_for_utc: r.scheduled_for_utc,
          status: r.status,
          sent_at: r.sent_at,
          error_message: r.error_message,
          gmail_thread_id: r.gmail_thread_id,
        }))}
      />
    </main>
  );
}

function StatTile(props: {
  label: string;
  count: number;
  tone: "accent" | "amber" | "green" | "red" | "dim";
}) {
  const colour = {
    accent: "var(--accent)",
    amber: "var(--amber)",
    green: "var(--green)",
    red: "var(--red)",
    dim: "var(--text-dim)",
  }[props.tone];
  return (
    <div className="rounded-[10px] border border-border bg-surface p-3 shadow-[var(--shadow)]">
      <div className="text-[11px] font-medium uppercase tracking-wide text-text-dim">
        {props.label}
      </div>
      <div
        className="mt-1 text-[20px] font-bold"
        style={{ color: colour }}
      >
        {props.count}
      </div>
    </div>
  );
}
