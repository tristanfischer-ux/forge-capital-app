import { DeskSearch } from "../DeskSearch";

export const dynamic = "force-dynamic";

export default function PersonIndexPage() {
  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p>
            One person, every raise they sit on. Use the search box — do
            not stay trapped on whoever opened last.
          </p>
        </div>
      </div>
      <div className="card" style={{ padding: 16 }}>
        <p className="sub" style={{ padding: 0 }}>
          Type a name. Or pick someone from Today, Company, Calendar, or Inbox.
        </p>
        <DeskSearch />
      </div>
    </div>
  );
}
