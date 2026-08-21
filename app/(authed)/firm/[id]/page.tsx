import Link from "next/link";
import { notFound } from "next/navigation";
import { skipRaiseName } from "@/lib/desk/status-map";
import { getInvestorProfile } from "@/lib/queries/investor-profile";
import { Hint } from "../../Hint";

export const dynamic = "force-dynamic";

export default async function DeskFirmPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const raw = (await params).id;
  if (/^[0-9a-f-]{36}$/i.test(raw)) {
    const { CapitalFirmPage } = await import("../../CapitalEntityPages");
    return <CapitalFirmPage id={raw} />;
  }
  const id = Number.parseInt(raw, 10);
  if (!Number.isFinite(id)) notFound();
  const firm = await getInvestorProfile(id);
  if (!firm) notFound();

  const liveLinks = firm.campaign_links.filter((l) => !skipRaiseName(l.campaign_name));
  const byPartner = new Map<number, typeof liveLinks>();
  for (const l of liveLinks) {
    if (l.partner_id == null) continue;
    const cur = byPartner.get(l.partner_id) ?? [];
    cur.push(l);
    byPartner.set(l.partner_id, cur);
  }

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>{firm.firm_name ?? "Firm"}</h1>
          <p>
            The fund. Two partners can be in play on the same raise — that
            is two rows. Use search at the top to jump to another firm.
          </p>
        </div>
        <div className="btn-row" style={{ margin: 0 }}>
          <Link href="/firm" className="btn">Find another firm</Link>
          <Link href="/today" className="btn">Back to Today</Link>
        </div>
      </div>
      {liveLinks.length > 0 ? (
        <div className="warn-banner">
          <strong>Already on a raise here.</strong>{" "}
          {liveLinks
            .map((l) => `${l.partner_name ?? "Someone"} · ${l.campaign_name} ${l.status_code ?? ""}`)
            .join(" · ")}
        </div>
      ) : null}
      <div className="grid-2">
        <div className="card">
          <h2>Partners at this firm</h2>
          <p className="sub">Who you have already spoken to is marked.</p>
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Title</th>
                <th>On a raise?</th>
              </tr>
            </thead>
            <tbody>
              {firm.partners.map((p) => {
                const links = byPartner.get(p.id) ?? [];
                return (
                  <tr key={p.id}>
                    <td><Link href={`/person/${p.id}`}>{p.name ?? "—"}</Link></td>
                    <td>{p.title}</td>
                    <td>
                      {links.length ? (
                        <Hint label="This person is on one of your live raises. Open them to see status.">
                          <span className="badge b-ok">
                            {links.map((l) => `${l.campaign_name} ${l.status_code ?? ""}`).join(" · ")}
                          </span>
                        </Hint>
                      ) : (
                        <span className="faint">Not contacted</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>From Forge Capital</h2>
          <p className="sub">Read-only directory on the fund.</p>
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
