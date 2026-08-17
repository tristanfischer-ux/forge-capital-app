import Link from "next/link";
import { getDeskToday } from "@/lib/queries/desk-today";

export const dynamic = "force-dynamic";

export default async function RaiseInboxPage() {
  const data = await getDeskToday();
  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Inbox — inbound, all raises</h1>
          <p>Replies land on the person. Filing stays on the thread so sync does not ask again.</p>
        </div>
      </div>
      <div className="card">
        <h2>Replies this week</h2>
        {data.replies.length === 0 ? (
          <p className="sub">No inbound contact_events in the last 7 days. Gmail sync fills this.</p>
        ) : (
          <table>
            <thead>
              <tr><th>When</th><th>From</th><th>Raise</th><th>Note</th></tr>
            </thead>
            <tbody>
              {data.replies.map((r) => (
                <tr key={r.id}>
                  <td>{r.event_at ? new Date(r.event_at).toLocaleString("en-GB") : "—"}</td>
                  <td>
                    {r.partner_id ? (
                      <Link href={`/person/${r.partner_id}`}>{r.partner_name}</Link>
                    ) : "—"}
                  </td>
                  <td><span className="badge b-raise">{r.campaign_name}</span></td>
                  <td>{(r.summary ?? "").slice(0, 80)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
