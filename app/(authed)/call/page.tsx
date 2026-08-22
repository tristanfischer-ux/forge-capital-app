import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findDeskMeeting } from "@/lib/queries/find-meeting";
import { getDeskToday } from "@/lib/queries/desk-today";

export const dynamic = "force-dynamic";

export default async function CallPage() {
  const today = await getDeskToday();
  const now = Date.now();
  const live = today.meetings.filter((m) => !m.canceled);
  const current = live.find((m) => {
    const start = Date.parse(m.event_at);
    const end = m.end_at
      ? Date.parse(m.end_at)
      : Number.isFinite(start)
        ? start + 45 * 60 * 1000
        : NaN;
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;
  });
  if (current) {
    redirect(`/meeting/${encodeURIComponent(current.id)}`);
  }

  const cookieStore = await cookies();
  const last = cookieStore.get("fc_current_call")?.value;
  if (last) {
    try {
      const found = await findDeskMeeting(decodeURIComponent(last));
      if (found) redirect(`/meeting/${encodeURIComponent(found.id)}`);
    } catch {
      /* stale cookie */
    }
  }

  const upcoming = live
    .filter((m) => Date.parse(m.event_at) >= now)
    .sort((a, b) => Date.parse(a.event_at) - Date.parse(b.event_at))[0];
  const fallback =
    upcoming ??
    [...live].sort((a, b) => Date.parse(b.event_at) - Date.parse(a.event_at))[0];
  if (fallback) {
    redirect(`/meeting/${encodeURIComponent(fallback.id)}`);
  }

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Current Call</h1>
          <p>
            Nothing on the book for this week. Open Today or Calendar and pick
            a slot — that becomes the working briefing.
          </p>
        </div>
        <div className="btn-row" style={{ margin: 0 }}>
          <Link href="/today" className="btn btn-primary">
            Today
          </Link>
          <Link href="/raise-calendar" className="btn">
            Calendar
          </Link>
        </div>
      </div>
    </div>
  );
}
