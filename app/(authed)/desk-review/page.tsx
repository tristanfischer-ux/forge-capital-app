import { ReviewActions } from "../ReviewActions";
import { listPendingQuarantine } from "@/lib/queries/capital-book";
import { normalizeFirmName } from "@/lib/desk/identity";


export const dynamic = "force-dynamic";

type QueueRow = {
  id?: string;
  campaign_name: string;
  firm_name: string | null;
  contact_name: string | null;
  email: string | null;
  status_raw: string | null;
  reason: string;
};

async function loadQueue(): Promise<{ rows: QueueRow[]; source: string }> {
  const pending = await listPendingQuarantine(200);
  const rows: QueueRow[] = pending.map((q) => {
    const raw = (q.raw_payload ?? {}) as {
      firm?: string | null;
      contact?: string | null;
      email?: string | null;
    };
    const sug = q.suggested_match as { canonical_name?: string; match_type?: string } | null;
    return {
      id: q.id,
      campaign_name: q.source ?? "tracker",
      firm_name: raw.firm ?? null,
      contact_name: raw.contact ?? null,
      email: raw.email ?? null,
      status_raw: sug?.match_type ?? q.status,
      reason: sug?.canonical_name
        ? `looks like ${sug.canonical_name}`
        : "pending match",
    };
  });
  return { rows, source: "shared book import_quarantine" };
}

export default async function DeskReviewPage() {
  const { rows, source } = await loadQueue();
  const error = source.startsWith("table not live") && rows.length === 0 ? source : null;

  return (
    <>
      <div className="wrap">
        <div className="page-head">
          <div>
            <h1>Review queue</h1>
            <p>
              Ticks that did not match one unique email. Merge a dirty
              name onto the real firm, file as needs-contact, or ignore.
              You do not send from here.
            </p>
          </div>
        </div>
        <div className="side-sub" style={{ marginBottom: 12 }}>Source: {source}</div>
        {error ? (
          <div className="walk-callout">
            Queue table is not live yet ({error}). Apply migration
            036_raise_desk.sql, then run the import script. Unmatched rows
            also land in data/import-review-queue.json.
          </div>
        ) : rows.length === 0 ? (
          <div className="side-card">
            No unresolved rows. Either the import has not run, or every
            ticked cell found a unique person.
          </div>
        ) : (
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Raise</th>
                  <th>Firm</th>
                  <th>Contact</th>
                  <th>Status raw</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id ?? `${r.firm_name}-${r.campaign_name}-${i}`}>
                    <td>{r.campaign_name}</td>
                    <td>
                      {r.firm_name}
                      {r.firm_name && normalizeFirmName(r.firm_name) !== r.firm_name ? (
                        <div className="faint">→ {normalizeFirmName(r.firm_name)}</div>
                      ) : null}
                      {r.id ? <ReviewActions id={r.id} firmName={r.firm_name} /> : null}
                    </td>
                    <td>
                      {r.contact_name}
                      <div className="side-sub">{r.email}</div>
                    </td>
                    <td>{r.status_raw}</td>
                    <td>{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
