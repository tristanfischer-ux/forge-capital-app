import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createServerClient } from "@/lib/supabase/server";
import { StageBanner } from "../StageBanner";

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
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("import_review_queue")
    .select("id, campaign_name, firm_name, contact_name, email, status_raw, reason, disposition")
    .eq("disposition", "unresolved")
    .order("created_at", { ascending: false })
    .limit(200);
  if (!error && data) return { rows: data as QueueRow[], source: "database" };

  const file = join(process.cwd(), "data/import-review-queue.json");
  if (existsSync(file)) {
    const arr = JSON.parse(await readFile(file, "utf8")) as QueueRow[];
    return { rows: arr.filter((r) => (r as { disposition?: string }).disposition !== "excluded").slice(0, 200), source: "local file" };
  }
  return { rows: [], source: error ? `table not live (${error.message})` : "empty" };
}

export default async function DeskReviewPage() {
  const { rows, source } = await loadQueue();
  const error = source.startsWith("table not live") && rows.length === 0 ? source : null;

  return (
    <>
      <StageBanner number={0} title="Review queue" />
      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <div>
            <div className="section-title">Review queue</div>
            <div className="section-sub">
              Unmatched or unmapped rows from the master tracker import.
              Unresolved ticked cells stay here. Nothing here is auto-sent.
            </div>
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
          <div className="approval-col">
            <table className="sheet" style={{ width: "100%" }}>
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
                    <td>{r.firm_name}</td>
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
      </section>
    </>
  );
}
