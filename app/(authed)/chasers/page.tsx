import { listNeverWritten, listQuietPeople } from "@/lib/capital/chasers";
import { MANDATE_CODES, type MandateCode } from "@/lib/capital/mandates";
import { ChaserClient } from "./ChaserClient";

export const dynamic = "force-dynamic";

function parseView(raw: string | undefined): "quiet" | "never" | "unverified" {
  if (raw === "never" || raw === "unverified") return raw;
  return "quiet";
}

function parseCode(raw: string | undefined): MandateCode | "ALL" {
  const code = (raw ?? "").trim().toUpperCase();
  return (MANDATE_CODES as readonly string[]).includes(code)
    ? (code as MandateCode)
    : "ALL";
}

export default async function ChasersPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; days?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const days = Math.min(90, Math.max(3, Number(sp.days ?? 10) || 10));
  const view = parseView(sp.view);
  const code = parseCode(sp.code);
  const quiet = await listQuietPeople({ quietDays: days });
  const never = view === "never" || view === "unverified" ? await listNeverWritten() : [];
  let rows =
    view === "never" ? never : view === "unverified" ? [...quiet, ...never] : quiet;
  if (code !== "ALL") rows = rows.filter((r) => r.mandateCode === code);
  if (view === "unverified") {
    rows = rows.filter((r) => r.emailState !== "verified");
  }

  const allQuiet = quiet.length;
  const counts = Object.fromEntries(
    MANDATE_CODES.map((c) => [c, quiet.filter((r) => r.mandateCode === c).length]),
  ) as Record<string, number>;

  const caption =
    view === "never"
      ? `${rows.length} never written`
      : view === "unverified"
        ? `${rows.length} unverified`
        : code === "ALL"
          ? `${allQuiet.toLocaleString("en-GB")} quiet for ${days} days, all programmes`
          : `${rows.length.toLocaleString("en-GB")} quiet on that programme · ${allQuiet.toLocaleString("en-GB")} across all`;

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Chasers</h1>
          <p>
            Everyone you have written to and not heard back from. {caption}.
            A chaser is a Gmail draft. Nothing sends. Verified addresses only.
          </p>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <form method="get" className="btn-row">
          {code !== "ALL" ? <input type="hidden" name="code" value={code} /> : null}
          <input type="hidden" name="view" value={view} />
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
      <ChaserClient
        days={days}
        rows={rows}
        view={view}
        code={code}
        allQuiet={allQuiet}
        counts={counts}
      />
    </div>
  );
}
