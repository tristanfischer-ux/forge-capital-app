import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { FollowUpRow } from "./FollowUpRow";

/**
 * Follow-ups page — surfaces every contact_events row with a
 * follow_up_due_at in the future + any past-due rows that haven't
 * been marked done. Sorted by due date ascending so today's
 * reminders come first.
 *
 * One-tap mark-done / snooze per row. Clicking the firm/partner
 * jumps to their profile + the most recent interaction.
 */
export const dynamic = "force-dynamic";

interface FollowUpJoinRow {
  id: string;
  campaign_partner_id: string;
  title: string | null;
  summary: string | null;
  notes: string | null;
  follow_up_due_at: string;
  event_at: string;
  event_type: string | null;
  campaign_partners: {
    status_code: string | null;
    status_label: string | null;
    partners_mirror: {
      id: number;
      name: string | null;
      title: string | null;
      investors_mirror: {
        id: number;
        firm_name: string | null;
      } | null;
    } | null;
    campaigns: {
      name: string | null;
    } | null;
  } | null;
}

export default async function FollowUpsPage() {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("contact_events")
    .select(
      `
      id,
      campaign_partner_id,
      title,
      summary,
      notes,
      follow_up_due_at,
      event_at,
      event_type,
      campaign_partners:campaign_partner_id (
        status_code,
        status_label,
        partners_mirror:partner_id (
          id,
          name,
          title,
          investors_mirror:investor_id (
            id,
            firm_name
          )
        ),
        campaigns:campaign_id (
          name
        )
      )
      `,
    )
    .not("follow_up_due_at", "is", null)
    .is("follow_up_done_at", null)
    .order("follow_up_due_at", { ascending: true })
    .limit(200);

  if (error) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-10">
        <h1 className="text-[20px] font-semibold text-text">Follow-ups</h1>
        <p className="mt-2 text-[13px] text-red">
          Failed to load: {error.message}
        </p>
      </main>
    );
  }

  const rows = (data ?? []) as unknown as FollowUpJoinRow[];

  // Bucket by due window for at-a-glance reading.
  const now = new Date();
  const today = new Date(now);
  today.setHours(23, 59, 59, 999);
  const oneWeek = new Date(now);
  oneWeek.setDate(oneWeek.getDate() + 7);
  oneWeek.setHours(23, 59, 59, 999);

  const overdue: FollowUpJoinRow[] = [];
  const dueToday: FollowUpJoinRow[] = [];
  const dueThisWeek: FollowUpJoinRow[] = [];
  const later: FollowUpJoinRow[] = [];

  for (const r of rows) {
    const due = new Date(r.follow_up_due_at);
    if (due < now) overdue.push(r);
    else if (due <= today) dueToday.push(r);
    else if (due <= oneWeek) dueThisWeek.push(r);
    else later.push(r);
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-[22px] font-bold tracking-[-0.01em] text-text">
          Follow-ups
        </h1>
        <p className="mt-2 text-[13px] text-text-dim leading-relaxed">
          Every contact_events row with an outstanding{" "}
          <code>follow_up_due_at</code> — sorted by due date. Logging a new
          interaction on the same partner closes out the open follow-up
          automatically (nothing to do manually); alternatively tap{" "}
          <em>Mark done</em> below to close without logging.
        </p>
      </header>

      <section className="mb-6 grid grid-cols-4 gap-3 text-[12px]">
        <StatTile label="Overdue" count={overdue.length} tone="red" />
        <StatTile label="Due today" count={dueToday.length} tone="amber" />
        <StatTile label="This week" count={dueThisWeek.length} tone="accent" />
        <StatTile label="Later" count={later.length} tone="dim" />
      </section>

      {rows.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-border bg-surface-alt p-6 text-center text-[13px] text-text-dim">
          Nothing due. When you log a call / meeting / note with a follow-up
          date, it appears here.
        </div>
      ) : (
        <>
          {overdue.length > 0 ? (
            <Bucket title="Overdue" tone="red">
              {overdue.map((r) => (
                <FollowUpRow
                  key={r.id}
                  contactEventId={r.id}
                  firmName={r.campaign_partners?.partners_mirror?.investors_mirror?.firm_name ?? null}
                  firmId={r.campaign_partners?.partners_mirror?.investors_mirror?.id ?? null}
                  partnerId={r.campaign_partners?.partners_mirror?.id ?? null}
                  partnerName={r.campaign_partners?.partners_mirror?.name ?? null}
                  partnerTitle={r.campaign_partners?.partners_mirror?.title ?? null}
                  campaignName={r.campaign_partners?.campaigns?.name ?? null}
                  statusCode={r.campaign_partners?.status_code ?? null}
                  statusLabel={r.campaign_partners?.status_label ?? null}
                  eventType={r.event_type}
                  eventAt={r.event_at}
                  dueAt={r.follow_up_due_at}
                  title={r.title ?? r.summary ?? null}
                  notes={r.notes ?? null}
                />
              ))}
            </Bucket>
          ) : null}
          {dueToday.length > 0 ? (
            <Bucket title="Due today" tone="amber">
              {dueToday.map((r) => (
                <FollowUpRow key={r.id} {...rowProps(r)} />
              ))}
            </Bucket>
          ) : null}
          {dueThisWeek.length > 0 ? (
            <Bucket title="This week" tone="accent">
              {dueThisWeek.map((r) => (
                <FollowUpRow key={r.id} {...rowProps(r)} />
              ))}
            </Bucket>
          ) : null}
          {later.length > 0 ? (
            <Bucket title="Later" tone="dim">
              {later.map((r) => (
                <FollowUpRow key={r.id} {...rowProps(r)} />
              ))}
            </Bucket>
          ) : null}
        </>
      )}
    </main>
  );
}

function rowProps(r: FollowUpJoinRow) {
  return {
    contactEventId: r.id,
    firmName:
      r.campaign_partners?.partners_mirror?.investors_mirror?.firm_name ??
      null,
    firmId:
      r.campaign_partners?.partners_mirror?.investors_mirror?.id ?? null,
    partnerId: r.campaign_partners?.partners_mirror?.id ?? null,
    partnerName: r.campaign_partners?.partners_mirror?.name ?? null,
    partnerTitle: r.campaign_partners?.partners_mirror?.title ?? null,
    campaignName: r.campaign_partners?.campaigns?.name ?? null,
    statusCode: r.campaign_partners?.status_code ?? null,
    statusLabel: r.campaign_partners?.status_label ?? null,
    eventType: r.event_type,
    eventAt: r.event_at,
    dueAt: r.follow_up_due_at,
    title: r.title ?? r.summary ?? null,
    notes: r.notes ?? null,
  };
}

function StatTile({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "red" | "amber" | "accent" | "dim";
}) {
  const bg =
    tone === "red"
      ? "var(--red-light)"
      : tone === "amber"
        ? "var(--amber-light)"
        : tone === "accent"
          ? "var(--accent-softer)"
          : "var(--surface-alt)";
  const colour =
    tone === "red"
      ? "var(--red)"
      : tone === "amber"
        ? "var(--amber)"
        : tone === "accent"
          ? "var(--accent-dark)"
          : "var(--text-dim)";
  return (
    <div
      style={{
        padding: "10px 12px",
        background: bg,
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: colour,
          lineHeight: 1,
        }}
      >
        {count}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "var(--text-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function Bucket({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "red" | "amber" | "accent" | "dim";
  children: React.ReactNode;
}) {
  const colour =
    tone === "red"
      ? "var(--red)"
      : tone === "amber"
        ? "var(--amber)"
        : tone === "accent"
          ? "var(--accent-dark)"
          : "var(--text-dim)";
  return (
    <section style={{ marginBottom: 22 }}>
      <h2
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.6px",
          color: colour,
          marginBottom: 8,
          paddingBottom: 6,
          borderBottom: `1px solid ${colour === "var(--text-dim)" ? "var(--border)" : colour}`,
        }}
      >
        {title}
      </h2>
      <ul style={{ display: "flex", flexDirection: "column", gap: 8, listStyle: "none", margin: 0, padding: 0 }}>
        {children}
      </ul>
      {false ? <Link href="/follow-ups">noop</Link> : null}
    </section>
  );
}
