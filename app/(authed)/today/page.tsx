import Link from "next/link";
import {
  badgeClassFor,
  permissionBadgeClass,
  permissionLabel,
} from "@/lib/desk/status-map";
import { getDeskToday } from "@/lib/queries/desk-today";
import { Hint } from "../Hint";

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

function meetingHref(id: string): string {
  return `/meeting/${encodeURIComponent(id)}`;
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail_connected?: string }>;
}) {
  const { gmail_connected } = await searchParams;
  const data = await getDeskToday();
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const firstBlock = data.blocks[0];
  const firstDouble = data.doubleAsks[0];
  const unmatched = data.meetings.filter((m) => m.unmatched).length;

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Today — {today}</h1>
          <p>
            Work queue for every raise. Hover a number if the jargon is
            unclear. Click a meeting to open the briefing.
          </p>
        </div>
        <div className="btn-row" style={{ margin: 0 }}>
          <Link href="/desk-review" className="btn">Review queue</Link>
          <Link href="/raise-excel" className="btn">Excel snapshot</Link>
        </div>
      </div>

      {gmail_connected === "1" ? (
        <div className="note" style={{ marginBottom: 16 }}>
          Google is connected. You are on the Raise desk, not the old
          Outreach pipeline.
        </div>
      ) : null}

      <div className="tiles">
        <Hint label="Meetings from your Google Calendar in the next week. Unmatched means the guest is not a unique email on the raise tracker yet — click the meeting to see who it is.">
          <div className="tile">
            <div className="k">Meetings</div>
            <div className="n">{data.meetings.length}</div>
            <div className="s">
              {unmatched} not yet on the tracker
            </div>
          </div>
        </Hint>
        <Hint label="Inbound emails from the last week that look like real people, not newsletters. Click Inbox to read the first lines.">
          <div className="tile">
            <div className="k">Replies</div>
            <div className="n">{data.replies.length}</div>
            <div className="s">inbound this week</div>
          </div>
        </Hint>
        <Hint label="People sitting at +0 (not emailed), +3 (email sent) or +5 (follow-up sent) whose last dated touch is more than a week ago. Grouped by raise in the table below.">
          <div className="tile warn">
            <div className="k">Quiet &gt; 7 days</div>
            <div className="n">{data.stuckCount}</div>
            <div className="s">no recent dated touch</div>
          </div>
        </Hint>
        <Hint label="The same person is live on two or more raises at once. Open the person before you queue another email so you do not ask twice.">
          <div className="tile bad">
            <div className="k">On two raises</div>
            <div className="n">{data.doubleAskCount}</div>
            <div className="s">same person, two live raises</div>
          </div>
        </Hint>
        <Hint label="Status +1 or +2: approved or drafted. These can enter the send queue. Nothing sends until you say so.">
          <div className="tile">
            <div className="k">Ready to draft</div>
            <div className="n">{data.approvalCount}</div>
            <div className="s">queue, not send</div>
          </div>
        </Hint>
      </div>

      {firstBlock ? (
        <div className="block-banner">
          <strong>Do not send — {firstBlock.partner_name ?? `partner ${firstBlock.partner_id}`}</strong>
          {firstBlock.reason ? `. ${firstBlock.reason}` : ""}. A person-level
          block beats any campaign status.
        </div>
      ) : null}

      {firstDouble ? (
        <div className="warn-banner">
          <strong>On two raises:</strong>{" "}
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
          <p className="sub">Click a row to open the briefing for that meeting.</p>
          {data.meetings.length === 0 ? (
            <p className="sub">No meetings in the next 7 days.</p>
          ) : (
            <table>
              <thead>
                <tr><th>When</th><th>Who</th><th>Raise</th></tr>
              </thead>
              <tbody>
                {data.meetings.map((m) => (
                  <tr key={m.id} className="clickable">
                    <td>
                      <Link href={meetingHref(m.id)}>{when(m.event_at)}</Link>
                    </td>
                    <td>
                      <Link href={meetingHref(m.id)}>
                        {m.partner_name ?? m.title ?? "Meeting"}
                      </Link>
                      <div className="faint">
                        {m.unmatched ? "Not on the tracker yet" : m.firm_name}
                      </div>
                    </td>
                    <td><span className="badge b-raise">{m.campaign_name ?? "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h2>Ready to draft — queue, not send</h2>
          <p className="sub">
            Status +1 (approved, needs a draft) or +2 (draft ready). Nothing
            leaves this desk until you send it yourself.
          </p>
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
        <h2>Quiet more than 7 days</h2>
        <p className="sub">
          Grouped by the company you are raising for, so a 200-name wave
          reads as a wave. “Open this raise” is the Company tab for that
          company.
        </p>
        {data.stuckByRaise.length === 0 ? (
          <p className="sub">No dated quiet rows.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Raise</th><th>Quiet</th><th>Oldest</th><th></th></tr>
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
                    <td>
                      <Hint label="Opens the Company tab for this raise — the tracker of everyone on that company.">
                        <Link href={href}>Open this raise</Link>
                      </Hint>
                    </td>
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
