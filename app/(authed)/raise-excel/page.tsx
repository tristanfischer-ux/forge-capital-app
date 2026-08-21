import Link from "next/link";

export default function RaiseExcelPage() {
  const day = new Date().toISOString().slice(0, 10);
  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Excel is a download</h1>
          <p>
            The live book is the shared database. Excel is only a backup.
            Do not type in the 17 Aug file — it is an archive. A new
            dated workbook is generated from the database.
          </p>
        </div>
      </div>
      <div className="note">
        Snapshot {day}. Change status on the Person page. Then download
        again if you need a file to email someone.
      </div>
      <div className="grid-2">
        <div className="card">
          <h2>Download the backup</h2>
          <p className="sub">
            Generated from the shared book. The 17 Aug original is
            untouched. Use the new dated file only as a backup.
          </p>
          <div className="btn-row">
            <a className="btn btn-primary" href="/api/export-master">
              Download snapshot
            </a>
          </div>
        </div>
        <div className="card">
          <h2>Rows that did not import cleanly</h2>
          <p className="sub">
            The 260812 book had ticks we could not match to a unique email.
            Those sit in Review until you file them. They are not missing
            from the backup — they were never a tracker row.
          </p>
          <div className="btn-row">
            <Link className="btn" href="/desk-review">Open the review queue</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
