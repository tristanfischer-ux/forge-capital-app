import { CalendarBoard } from "../CalendarBoard";
import { listWeekAheadCalendar } from "@/lib/capital/live-calendar";

export const dynamic = "force-dynamic";

export default async function RaiseCalendarPage() {
  const week = await listWeekAheadCalendar();
  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Calendar — the week ahead</h1>
          <p>
            Everything on your Google Calendar for the next seven days,
            including weekends. Blocks are coloured by programme when the
            title or guests make that obvious.
          </p>
        </div>
      </div>
      <CalendarBoard
        initial={week.events}
        initialDays={week.days}
        googleOk={week.googleOk}
        needsCalendarScope={week.needsCalendarScope}
        error={week.error}
      />
    </div>
  );
}
