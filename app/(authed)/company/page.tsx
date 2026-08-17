import Link from "next/link";
import {
  badgeClassFor,
  labelFor,
  permissionBadgeClass,
  permissionLabel,
  skipRaiseName,
} from "@/lib/desk/status-map";
import { listActiveCampaigns } from "@/lib/queries/campaigns";
import { getTrackerRows } from "@/lib/queries/tracker";

export const dynamic = "force-dynamic";

export default async function CompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const campaigns = (await listActiveCampaigns()).filter(
    (x) =>
      x.campaign_intent === "investor" &&
      !skipRaiseName(x.name) &&
      x.partner_count > 0,
  );
  const selected =
    campaigns.find((x) => x.id === c || x.name === c) ?? campaigns[0] ?? null;
  const rows = selected ? await getTrackerRows(selected.id) : [];

  const pending = rows.filter((r) => r.status_code === "+0" || r.status_code === "+1");
  const sent = rows.filter((r) => r.status_code === "+3" || r.status_code === "+5");
  const motion = rows.filter((r) =>
    ["+3", "+5", "+6", "+6.5", "+7", "+8", "+9"].includes(r.status_code ?? ""),
  );
  const committed = rows.filter((r) =>
    ["+10", "+11", "+12"].includes(r.status_code ?? ""),
  );
  const dead = rows.filter((r) => (r.status_code ?? "").startsWith("-"));
  const alsoElsewhere = rows.filter((r) =>
    r.other_campaigns.some((name) => !skipRaiseName(name)),
  );

  const tableRows = [...rows].sort((a, b) => {
    const firm = (a.firm_name ?? "").localeCompare(b.firm_name ?? "");
    if (firm !== 0) return firm;
    return (a.partner_name ?? "").localeCompare(b.partner_name ?? "");
  });

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>{selected?.name ?? "Company"} — this raise</h1>
          <p>
            One company at a time. Permission is a column, not a status.
            Cross-raise chips show when the same person is live elsewhere.
          </p>
        </div>
      </div>
      <div className="btn-row">
        {campaigns.map((camp) => (
          <Link
            key={camp.id}
            href={`/company?c=${camp.id}`}
            className={camp.id === selected?.id ? "btn btn-primary" : "btn"}
          >
            {camp.name} ({camp.partner_count})
          </Link>
        ))}
      </div>
      <div className="tiles">
        <div className="tile">
          <div className="k">On this raise</div>
          <div className="n">{rows.length}</div>
          <div className="s">live tracker rows</div>
        </div>
        <div className="tile">
          <div className="k">+0 pending</div>
          <div className="n">{rows.filter((r) => r.status_code === "+0").length}</div>
          <div className="s">need a first send</div>
        </div>
        <div className="tile">
          <div className="k">+3 / +5 sent</div>
          <div className="n">{sent.length}</div>
          <div className="s">waiting on a reply</div>
        </div>
        <div className="tile">
          <div className="k">Dead</div>
          <div className="n">{dead.length}</div>
          <div className="s">declined / bounced / out</div>
        </div>
        <div className="tile warn">
          <div className="k">Also on another raise</div>
          <div className="n">{alsoElsewhere.length}</div>
          <div className="s">see person before you send</div>
        </div>
      </div>
      <div className="kanban">
        <div className="col">
          <h3>Pending</h3>
          {pending.slice(0, 6).map((r) => (
            <div key={r.id} className="chip-row">
              <Link href={r.partner_id ? `/person/${r.partner_id}` : "/company"}>
                {r.partner_name ?? r.firm_name}
              </Link>
              <div className="faint">{r.status_code} {r.firm_name}</div>
            </div>
          ))}
        </div>
        <div className="col">
          <h3>In motion</h3>
          {motion.slice(0, 6).map((r) => (
            <div key={r.id} className="chip-row">
              <Link href={r.partner_id ? `/person/${r.partner_id}` : "/company"}>
                {r.partner_name ?? r.firm_name}
              </Link>
              <div className="faint">{r.status_code} {labelFor(r.status_code) ?? ""}</div>
            </div>
          ))}
        </div>
        <div className="col">
          <h3>Committed family</h3>
          {committed.slice(0, 6).map((r) => (
            <div key={r.id} className="chip-row">{r.firm_name} {r.status_code}</div>
          ))}
        </div>
        <div className="col">
          <h3>Dead</h3>
          {dead.slice(0, 6).map((r) => (
            <div key={r.id} className="chip-row">{r.firm_name} {r.status_code}</div>
          ))}
        </div>
      </div>
      <div className="card">
        <h2>Tracker — this raise only</h2>
        <p className="sub">Click a person to see every raise they are on.</p>
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Firm</th>
              <th>Status</th>
              <th>Permission</th>
              <th>Other raises</th>
              <th>Last touch</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((r) => {
              const others = r.other_campaigns.filter((name) => !skipRaiseName(name));
              return (
                <tr key={r.id} className="clickable">
                  <td>
                    {r.partner_id ? (
                      <Link href={`/person/${r.partner_id}`}>{r.partner_name ?? "—"}</Link>
                    ) : "—"}
                  </td>
                  <td>{r.firm_name}</td>
                  <td>
                    <span className={`badge ${badgeClassFor(r.status_code)}`}>
                      {r.status_code} {labelFor(r.status_code) ?? r.status_label ?? ""}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${permissionBadgeClass(r.permission_status)}`}>
                      {permissionLabel(r.permission_status)}
                    </span>
                  </td>
                  <td>{others.length ? others.join(" · ") : "—"}</td>
                  <td>{r.days_since_last_contact ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
