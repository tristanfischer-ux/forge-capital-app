import Link from "next/link";
import { getDeskToday } from "@/lib/queries/desk-today";

export const dynamic = "force-dynamic";

function ymdLocal(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function timeLocal(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default async function RaiseCalendarPage() {
  const data = await getDeskToday();
  const start = new Date();
  const monday = new Date(start);
  const day = monday.getDay();
  monday.setDate(monday.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Calendar — this week</h1>
          <p>
            Meetings from the primary Google Calendar. Unmatched attendees
            go to Review, not a silent skip.
          </p>
        </div>
      </div>
      <div className="note">
        Stored Gmail/Calendar OAuth is revoked, so the launchd sync cannot
        refresh itself. This week was ingested from the live Google account.
        Reconnect at{" "}
        <Link href="/api/auth/gmail?next=/raise-calendar">Connect Google</Link>{" "}
        so the desk stays current without a hand ingest.
      </div>
      <div className="cal cal-days">
        {days.map((d) => {
          const key = ymdLocal(d);
          const events = data.meetings.filter((m) => ymdLocal(m.event_at) === key);
          return (
            <div key={key} className="cal-day">
              <div className="hd">
                {d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}
              </div>
              {events.length === 0 ? (
                <div className="faint" style={{ padding: 8 }}>No meetings</div>
              ) : (
                events.map((m) => (
                  <div
                    key={m.id}
                    className={`evt${m.unmatched ? " unmatched" : ""}`}
                  >
                    <div className="faint">{timeLocal(m.event_at)}</div>
                    {m.partner_id ? (
                      <Link href={`/person/${m.partner_id}`}>
                        {m.partner_name ?? m.title}
                      </Link>
                    ) : (
                      <span>{m.partner_name ?? m.title ?? "Meeting"}</span>
                    )}
                    <div className="faint">
                      {m.campaign_name ?? (m.unmatched ? "unmatched" : "—")}
                    </div>
                    {m.unmatched ? (
                      <Link href="/desk-review">File this</Link>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
      {data.meetings.length === 0 ? (
        <p className="faint" style={{ marginTop: 12 }}>
          No meetings in the ingested week. Reconnect Google or re-run
          scripts/ingest-desk-week.mjs.
        </p>
      ) : null}
    </div>
  );
}
