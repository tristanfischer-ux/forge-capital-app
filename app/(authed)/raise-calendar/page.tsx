import Link from "next/link";
import { getDeskToday } from "@/lib/queries/desk-today";

export const dynamic = "force-dynamic";

export default async function RaiseCalendarPage() {
  const data = await getDeskToday();
  const start = new Date();
  const monday = new Date(start);
  const day = monday.getDay();
  monday.setDate(monday.getDate() - ((day + 6) % 7));
  const days = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  function ymdLocal(value: Date | string): string {
    const d = typeof value === "string" ? new Date(value) : value;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Calendar — this week</h1>
          <p>Meetings from Google Calendar ingest. Unmatched attendees go to Review.</p>
        </div>
      </div>
      <div className="cal">
        <div className="hd" />
        {days.map((d) => (
          <div key={d.toISOString()} className="hd">
            {d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}
          </div>
        ))}
        <div className="hour">09–18</div>
        {days.map((d) => {
          const key = ymdLocal(d);
          const events = data.meetings.filter((m) => ymdLocal(m.event_at) === key);
          return (
            <div key={key}>
              {events.map((m) => (
                <div key={m.id} className="evt">
                  {m.partner_id ? (
                    <Link href={`/person/${m.partner_id}`}>{m.partner_name}</Link>
                  ) : (
                    m.title ?? "Meeting"
                  )}
                  <div>{m.campaign_name}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {data.meetings.length === 0 ? (
        <p className="faint" style={{ marginTop: 12 }}>
          No meetings in contact_events for the next 7 days.
        </p>
      ) : null}
    </div>
  );
}
