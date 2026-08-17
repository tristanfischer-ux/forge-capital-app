import Link from "next/link";

export default function RaiseExcelPage() {
  const day = new Date().toISOString().slice(0, 10);
  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Excel is a download</h1>
          <p>
            The desk writes the file. You do not write the file. Filename
            never contains CANONICAL.
          </p>
        </div>
      </div>
      <div className="note">
        Snapshot {day} · edit in the desk, not the workbook.
      </div>
      <div className="grid-2">
        <div className="card">
          <h2>Master (by raise)</h2>
          <p className="sub">
            One row per person × raise from the live database. This is
            the backup you asked for.
          </p>
          <div className="btn-row">
            <a className="btn btn-primary" href="/api/export-master">
              Download snapshot
            </a>
          </div>
        </div>
        <div className="card">
          <h2>Review queue</h2>
          <p className="sub">
            Rows from the 260812 book that did not match a unique email
            stay here until you file them.
          </p>
          <div className="btn-row">
            <Link className="btn" href="/desk-review">Open review queue</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
