import Link from "next/link";
import { listChasers } from "@/lib/capital/chasers";
import { MANDATE_OPTIONS, type MandateCode } from "@/lib/capital/mandates";
import { ChaserClient } from "./ChaserClient";

export const dynamic = "force-dynamic";

export default async function ChasersPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; days?: string }>;
}) {
  const sp = await searchParams;
  const code = ((sp.code ?? "SS").toUpperCase() as MandateCode) || "SS";
  const days = Math.min(90, Math.max(3, Number(sp.days ?? 10) || 10));
  const rows = await listChasers({ mandateCode: code, quietDays: days });
  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Chasers</h1>
          <p>
            People you wrote to who have not replied in {days} days. A chaser
            is a Gmail draft with a calendar link. Nothing sends.
          </p>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="btn-row">
          {MANDATE_OPTIONS.map((m) => (
            <Link
              key={m.code}
              className={m.code === code ? "btn btn-primary" : "btn"}
              href={`/chasers?code=${m.code}&days=${days}`}
            >
              {m.label}
            </Link>
          ))}
        </div>
        <form method="get" className="btn-row">
          <input type="hidden" name="code" value={code} />
          <label className="faint">
            Quiet days{" "}
            <input
              type="number"
              name="days"
              defaultValue={days}
              min={3}
              max={90}
              style={{ width: 72, padding: 6 }}
            />
          </label>
          <button type="submit" className="btn">
            Apply
          </button>
        </form>
      </div>
      <ChaserClient code={code} days={days} rows={rows} />
    </div>
  );
}
