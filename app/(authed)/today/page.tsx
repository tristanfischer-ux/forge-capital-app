import Link from "next/link";
import { getDeskToday } from "@/lib/queries/desk-today";
import { StageBanner } from "../StageBanner";

export const dynamic = "force-dynamic";

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function TodayPage() {
  const data = await getDeskToday();
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <>
      <StageBanner number={0} title="Today" />
      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <div>
            <div className="section-title">Today — {today}</div>
            <div className="section-sub">
              All raises. Meetings, replies, stuck waves, and anything
              that would be a double-ask. This is the live desk, not the
              dummy.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link href="/desk-review" className="as-link">
              Review queue →
            </Link>
            <Link href="/api/export-master" className="as-link">
              Download Excel snapshot →
            </Link>
          </div>
        </div>

        <div className="stat-tiles" style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: 12, marginBottom: 20 }}>
          <Stat k="Meetings (7 days)" n={data.meetings.length} />
          <Stat k="Replies (7 days)" n={data.replies.length} />
          <Stat k="Stuck &gt; 7 days" n={data.stuck.length} />
          <Stat k="On two+ raises" n={data.doubleAsks.length} />
          <Stat k="Ready to draft (+1/+2)" n={data.approvals.length} />
        </div>

        {data.blocks.length > 0 ? (
          <div className="walk-callout" style={{ marginBottom: 16 }}>
            <strong>Do-not-outreach blocks:</strong>{" "}
            {data.blocks.slice(0, 8).map((b) => (
              <span key={b.partner_id}>
                {b.partner_name ?? `partner ${b.partner_id}`}
                {b.reason ? ` (${b.reason})` : ""}
                {"; "}
              </span>
            ))}
          </div>
        ) : null}

        {data.doubleAsks.length > 0 ? (
          <div className="conflict-banner" style={{ marginBottom: 16 }}>
            <strong>Double-ask:</strong> {data.doubleAsks.length} people
            are live on more than one raise. Open the person before you
            queue a send.
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16 }}>
          <Panel title="Next meetings" empty="No meetings in the next 7 days in contact_events.">
            {data.meetings.map((m) => (
              <tr key={m.id}>
                <td>{when(m.event_at)}</td>
                <td>
                  {m.partner_id ? (
                    <Link href={`/partner/${m.partner_id}`}>{m.partner_name ?? "Partner"}</Link>
                  ) : (
                    <span>{m.title ?? m.summary ?? "Unmatched"}</span>
                  )}
                  <div className="side-sub">{m.firm_name}</div>
                </td>
                <td>{m.campaign_name ?? "—"}</td>
                <td>{m.status_code ?? ""}</td>
              </tr>
            ))}
          </Panel>
          <Panel title="Approvals — queue, not send" empty="No +1 / +2 rows.">
            {data.approvals.map((a) => (
              <tr key={a.campaign_partner_id}>
                <td>
                  {a.partner_id ? (
                    <Link href={`/partner/${a.partner_id}`}>{a.partner_name ?? "Partner"}</Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{a.campaign_name}</td>
                <td>{a.status_code}</td>
                <td>
                  {a.blocked ? "BLOCKED" : a.permission_status}
                </td>
              </tr>
            ))}
          </Panel>
        </div>

        <div style={{ marginTop: 16 }}>
          <Panel title="Replies this week" empty="No inbound contact_events in the last 7 days. Gmail sync fills this.">
            {data.replies.map((r) => (
              <tr key={r.id}>
                <td>{when(r.event_at)}</td>
                <td>
                  {r.partner_id ? (
                    <Link href={`/partner/${r.partner_id}`}>{r.partner_name ?? "Partner"}</Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{r.campaign_name}</td>
                <td>{(r.summary ?? "").slice(0, 80)}</td>
              </tr>
            ))}
          </Panel>
        </div>

        <div style={{ marginTop: 16 }}>
          <Panel title="Stuck more than 7 days" empty="No +0 / +3 / +5 rows older than a week.">
            {data.stuck.slice(0, 25).map((s) => (
              <tr key={s.campaign_partner_id}>
                <td>{s.campaign_name}</td>
                <td>
                  {s.partner_id ? (
                    <Link href={`/partner/${s.partner_id}`}>{s.partner_name ?? s.firm_name ?? "—"}</Link>
                  ) : (
                    s.firm_name
                  )}
                </td>
                <td>{s.status_code}</td>
                <td>{s.days}d</td>
              </tr>
            ))}
          </Panel>
        </div>

        <div style={{ marginTop: 16 }}>
          <Panel title="People on two or more raises" empty="No cross-raise overlap in the live tracker.">
            {data.doubleAsks.map((d) => (
              <tr key={d.partner_id}>
                <td>
                  <Link href={`/partner/${d.partner_id}`}>{d.partner_name ?? d.firm_name ?? d.partner_id}</Link>
                </td>
                <td>{d.firm_name}</td>
                <td>
                  {d.raises.map((r) => `${r.campaign_name} ${r.status_code ?? ""}`).join(" · ")}
                </td>
              </tr>
            ))}
          </Panel>
        </div>
      </section>
    </>
  );
}

function Stat({ k, n }: { k: string; n: number }) {
  return (
    <div className="side-card" style={{ marginBottom: 0 }}>
      <div className="side-sub">{k}</div>
      <div style={{ fontSize: 26, fontWeight: 700 }}>{n}</div>
    </div>
  );
}

function Panel({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const rows = Array.isArray(children) ? children : [children];
  const has = rows.filter(Boolean).length > 0 && !(Array.isArray(children) && children.length === 0);
  return (
    <div className="approval-col" style={{ overflow: "hidden" }}>
      <div className="sheet-head-strip">
        <div className="sh-left">
          <strong>{title}</strong>
        </div>
      </div>
      {!has ? (
        <div className="side-sub" style={{ padding: 16 }}>{empty}</div>
      ) : (
        <table className="sheet" style={{ width: "100%" }}>
          <tbody>{children}</tbody>
        </table>
      )}
    </div>
  );
}
