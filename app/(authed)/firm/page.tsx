import { DeskSearch } from "../DeskSearch";

export const dynamic = "force-dynamic";

export default function FirmIndexPage() {
  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Firms</h1>
          <p>
            The fund, not the tracker row. Search for Lowercarbon, Project
            A, and so on.
          </p>
        </div>
      </div>
      <div className="card" style={{ padding: 16 }}>
        <p className="sub" style={{ padding: 0 }}>
          Type a firm name. Partners at that firm show who you have already spoken to.
        </p>
        <DeskSearch />
      </div>
    </div>
  );
}
