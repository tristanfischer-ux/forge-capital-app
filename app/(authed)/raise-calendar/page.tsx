import { CalendarBoard } from "../CalendarBoard";
import { getDeskToday } from "@/lib/queries/desk-today";

export const dynamic = "force-dynamic";

export default async function RaiseCalendarPage() {
  const data = await getDeskToday();
  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Calendar — the week ahead</h1>
          <p>
            The shape of the week from Google Calendar. Click a block for the
            briefing — who it is, the mail, and which programme it belongs to.
          </p>
        </div>
      </div>
      <CalendarBoard initial={data.meetings} />
    </div>
  );
}
