import Link from "next/link";
import {
  badgeClassFor,
  permissionBadgeClass,
  permissionLabel,
} from "@/lib/desk/status-map";
import { getDeskToday } from "@/lib/queries/desk-today";

export const dynamic = "force-dynamic";

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    weekday: "short",
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
  const firstBlock = data.blocks[0];
  const firstDouble = data.doubleAsks[0];

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Today — {today}</h1>
          <p>
            All raises. Work queue, not another dashboard. Double-ask and
            do-not-outreach sit at the top so a 200-email wave cannot hide them.
          </p>
        </div>
        <div className="btn-row" style={{ margin: 0 }}>
          <Link href="/desk-review" className="btn">Review queue</Link>
          <Link href="/raise-excel" className="btn">Excel snapshot</Link>
        </div>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="k">Meetings (7 days)</div>
          <div className="n">{data.meetings.length}</div>
          <div className="s">{data.meetings.filter((m) => m.unmatched).length} unmatched</div>
        </div>
        <div className="tile">
          <div className="k">Replies (7 days)</div>
          <div className="n">{data.replies.length}</div>
          <div className="s">from Gmail sync</div>
        </div>
        <div className="tile warn">
          <div className="k">Stuck &gt; 7 days</div>
          <div className="n">{data.stuckCount}</div>
          <div className="s">+0 / +3 / +5 with a dated last touch</div>
        </div>
        <div className="tile bad">
          <div className="k">Double-ask</div>
          <div className="n">{data.doubleAskCount}</div>
          <div className="s">same person, two live raises</div>
        </div>
        <div className="tile">
          <div className="k">Ready to draft</div>
          <div className="n">{data.approvalCount}</div>
          <div className="s">+1 / +2 — queue, not send</div>
        </div>
      </div>

      {firstBlock ? (
        <div className="block-banner">
          <strong>Do not send — {firstBlock.partner_name ?? `partner ${firstBlock.partner_id}`}</strong>
          {firstBlock.reason ? `. ${firstBlock.reason}` : ""}. Person-global
          block beats any campaign +2.
        </div>
      ) : null}

      {firstDouble ? (
        <div className="warn-banner">
          <strong>Double-ask:</strong>{" "}
          <Link href={`/person/${firstDouble.partner_id}`}>
            {firstDouble.partner_name ?? firstDouble.firm_name}
          </Link>{" "}
          is on {firstDouble.raises.map((r) => `${r.campaign_name} ${r.status_code ?? ""}`).join(" · ")}.
          Open the person before you queue a send. {data.doubleAskCount} people in this state.
        </div>
      ) : null}

      <div className="grid-2">
        <div className="card">
          <h2>Next meetings</h2>
          <p className="sub">From Google Calendar ingest. Unmatched attendees go to Review.</p>
          {data.meetings.length === 0 ? (
            <p className="sub">No meetings in the next 7 days in contact_events yet. Calendar sync fills this.</p>
          ) : (
            <table>
              <thead>
                <tr><th>When</th><th>Who</th><th>Raise</th></tr>
              </thead>
              <tbody>
                {data.meetings.map((m) => (
                  <tr key={m.id} className="clickable">
                    <td>{when(m.event_at)}</td>
                    <td>
                      {m.partner_id ? (
                        <Link href={`/person/${m.partner_id}`}>{m.partner_name ?? "Partner"}</Link>
                      ) : (
                        m.title ?? m.summary ?? "Unmatched"
                      )}
                      <div className="faint">{m.firm_name}</div>
                    </td>
                    <td><span className="badge b-raise">{m.campaign_name ?? "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h2>Approvals — queue, not send</h2>
          <p className="sub">Nothing enters the send queue unless status is +1 or +2 and permission is approved or not required.</p>
          {data.approvals.length === 0 ? (
            <p className="sub">No +1 / +2 rows.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Person</th><th>Raise</th><th>Status</th><th>Permission</th></tr>
              </thead>
              <tbody>
                {data.approvals.slice(0, 20).map((a) => (
                  <tr key={a.campaign_partner_id}>
                    <td>
                      {a.partner_id ? (
                        <Link href={`/person/${a.partner_id}`}>{a.partner_name ?? "—"}</Link>
                      ) : "—"}
                    </td>
                    <td>{a.campaign_name}</td>
                    <td><span className={`badge ${badgeClassFor(a.status_code)}`}>{a.status_code}</span></td>
                    <td>
                      <span className={`badge ${permissionBadgeClass(a.permission_status, a.blocked)}`}>
                        {permissionLabel(a.permission_status, a.blocked)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Stuck more than 7 days</h2>
        <p className="sub">Status +0 or +3 or +5 with a last-touch date. Grouped by raise so a wave is visible as a wave.</p>
        {data.stuckByRaise.length === 0 ? (
          <p className="sub">No dated +0 / +3 / +5 rows older than 7 days.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Raise</th><th>Stuck</th><th>Oldest</th><th></th></tr>
            </thead>
            <tbody>
              {data.stuckByRaise.map((g) => {
                const href = g.campaign_id
                  ? `/company?c=${g.campaign_id}`
                  : `/company?c=${encodeURIComponent(g.campaign_name ?? "")}`;
                return (
                  <tr key={g.campaign_id ?? g.campaign_name ?? "raise"}>
                    <td><Link href={href}>{g.campaign_name}</Link></td>
                    <td>{g.count}</td>
                    <td>
                      {g.oldestDays == null ? "no date" : `${g.oldestDays} days`}
                      {g.oldestName ? ` · ${g.oldestName}` : ""}
                    </td>
                    <td><Link href={href}>Open raise</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
