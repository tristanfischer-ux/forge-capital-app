import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvestorProfile } from "@/lib/queries/investor-profile";

export const dynamic = "force-dynamic";

export default async function DeskFirmPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number.parseInt((await params).id, 10);
  if (!Number.isFinite(id)) notFound();
  const firm = await getInvestorProfile(id);
  if (!firm) notFound();

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>{firm.firm_name ?? "Firm"}</h1>
          <p>
            The fund is not the tracker row. Two partners can be in play on
            the same raise — that is two rows.
          </p>
        </div>
      </div>
      {firm.campaign_links.length > 0 ? (
        <div className="warn-banner">
          <strong>Already contacted here.</strong>{" "}
          {firm.campaign_links
            .map((l) => `${l.campaign_name} ${l.status_code ?? ""}`)
            .join(" · ")}
        </div>
      ) : null}
      <div className="grid-2">
        <div className="card">
          <h2>Partners at this firm</h2>
          <table>
            <thead>
              <tr><th>Person</th><th>Title</th></tr>
            </thead>
            <tbody>
              {firm.partners.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/person/${p.id}`}>{p.name ?? "—"}</Link></td>
                  <td>{p.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Encyclopaedia (read-only)</h2>
          <table>
            <tbody>
              <tr><th>Website</th><td>{firm.website ?? "—"}</td></tr>
              <tr><th>HQ</th><td>{firm.hq_location ?? "—"}</td></tr>
              <tr><th>Stage</th><td>{firm.stage_focus ?? "—"}</td></tr>
              <tr><th>Sectors</th><td>{firm.sector_focus ?? "—"}</td></tr>
              <tr><th>Thesis</th><td>{firm.thesis_summary ?? "—"}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
