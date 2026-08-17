import { CalendarBoard } from "../CalendarBoard";
import { getDeskToday } from "@/lib/queries/desk-today";

export const dynamic = "force-dynamic";

export default async function RaiseCalendarPage() {
  const data = await getDeskToday();
  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Calendar — this week</h1>
          <p>
            Your real Google Calendar. Click a block to open the briefing —
            who it is, what the invite says, and which raise it belongs to.
          </p>
        </div>
      </div>
      <CalendarBoard initial={data.meetings} />
    </div>
  );
}
