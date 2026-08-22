import { cookies } from "next/headers";
import { listChasers } from "@/lib/capital/chasers";
import { MANDATE_LABEL } from "@/lib/capital/mandates";
import { parseProgramme } from "@/lib/desk/programme";
import { ChaserClient } from "./ChaserClient";

export const dynamic = "force-dynamic";

export default async function ChasersPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; days?: string }>;
}) {
  const sp = await searchParams;
  const cookieStore = await cookies();
  const code = parseProgramme(sp.code ?? cookieStore.get("fc_programme")?.value);
  const days = Math.min(90, Math.max(3, Number(sp.days ?? 10) || 10));
  const rows = await listChasers({ mandateCode: code, quietDays: days });
  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Chasers</h1>
          <p>
            {MANDATE_LABEL[code]} — {rows.length} quiet for {days} days. A chaser
            is a Gmail draft. Nothing sends. Use the programme chip in the header
            to switch. Drafts still need a verified address.
          </p>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
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
