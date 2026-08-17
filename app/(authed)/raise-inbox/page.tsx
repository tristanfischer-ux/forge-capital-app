import Link from "next/link";
import { getDeskToday } from "@/lib/queries/desk-today";
import { decodeMailText } from "@/lib/queries/meeting-brief";
import { lookupRegistry, roleLabel } from "@/lib/desk/identity";
import { Hint } from "../Hint";
import { ReplyBox } from "../ReplyBox";

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
        Reply or park a Gmail draft on a row. Sending is two clicks and
        never automatic.{" "}
        <a href="https://mail.google.com" target="_blank" rel="noreferrer">
          Open Gmail
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
              {data.replies.map((r) => {
                const email =
                  r.from?.match(/[\w.+-]+@[\w.-]+/)?.[0] ?? "";
                const role = lookupRegistry({ name: r.partner_name ?? r.from, email });
                return (
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
                      r.partner_name ?? r.from ?? "—"
                    )}
                    {role ? (
                      <div className="faint">{roleLabel(role.role)}</div>
                    ) : !r.partner_id ? (
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
                      <div className="faint">{decodeMailText(r.preview).slice(0, 180)}</div>
                    ) : null}
                    {email ? (
                      <ReplyBox to={email} subject={r.summary ?? ""} />
                    ) : null}
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
