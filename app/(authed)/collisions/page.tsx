import Link from "next/link";
import { listCollisions } from "@/lib/capital/collision";
import { COLLISION_DAYS } from "@/lib/capital/mandates";

export const dynamic = "force-dynamic";

export default async function CollisionsPage() {
  const rows = await listCollisions(COLLISION_DAYS);
  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Cross-mandate collisions</h1>
          <p>
            Anyone approached on more than one raise in the last {COLLISION_DAYS}{" "}
            days. False negatives here damage relationships.
          </p>
        </div>
        <Link className="btn" href="/today">
          Today
        </Link>
      </div>
      <div className="card">
        {rows.length === 0 ? (
          <p className="sub">No collisions in the last {COLLISION_DAYS} days on the book.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Firm</th>
                <th>Raise A</th>
                <th>Raise B</th>
                <th>Dates</th>
                <th>Days apart</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.person_id}-${r.firm_id}-${i}`}>
                  <td>
                    {r.person_id ? (
                      <Link href={`/person/${r.person_id}`}>{r.person_name ?? "Person"}</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {r.firm_id ? (
                      <Link href={`/firm/${r.firm_id}`}>{r.firm_name ?? "Firm"}</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{r.mandate_a}</td>
                  <td>{r.mandate_b}</td>
                  <td>
                    {r.date_a} / {r.date_b}
                  </td>
                  <td>{r.days_apart}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
