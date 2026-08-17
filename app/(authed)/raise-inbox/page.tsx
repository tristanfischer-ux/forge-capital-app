import Link from "next/link";
import { getDeskToday } from "@/lib/queries/desk-today";
import { Hint } from "../Hint";

export const dynamic = "force-dynamic";

export default async function RaiseInboxPage() {
  const data = await getDeskToday();
  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Inbox — inbound, all raises</h1>
          <p>
            Replies from the last week. Click the person to open their
            page. The first lines of the mail are in the last column.
          </p>
        </div>
      </div>
      <div className="note">
        Google is connected. This list is the live mailbox filtered to
        people, not newsletters. A full reply / forward / attach composer
        in this desk is next — for now open the person, or{" "}
        <a href="https://mail.google.com" target="_blank" rel="noreferrer">
          Gmail
        </a>
        .
      </div>
      <div className="card">
        <h2>Replies this week</h2>
        {data.replies.length === 0 ? (
          <p className="sub">No inbound rows in the last 10 days.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>From</th>
                <th>Raise</th>
                <th>Subject and opening</th>
              </tr>
            </thead>
            <tbody>
              {data.replies.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.event_at
                      ? new Date(r.event_at).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </td>
                  <td>
                    {r.partner_id ? (
                      <Link href={`/person/${r.partner_id}`}>{r.partner_name}</Link>
                    ) : (
                      r.partner_name ?? "—"
                    )}
                    {!r.partner_id ? (
                      <Hint label="We have their email, but they are not a unique person on the raise tracker.">
                        <div className="faint">not on the tracker yet</div>
                      </Hint>
                    ) : null}
                  </td>
                  <td>
                    <span className="badge b-raise">{r.campaign_name ?? "—"}</span>
                  </td>
                  <td>
                    <div>{r.summary}</div>
                    {r.preview ? (
                      <div className="faint">{r.preview.slice(0, 180)}</div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
