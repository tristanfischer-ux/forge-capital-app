import Link from "next/link";
import { notFound } from "next/navigation";
import { badgeClassForEmailState, badgeForEmailState } from "@/lib/capital/neverbounce";
import { createCoreClient, createEngageClient } from "@/lib/supabase/capital";
import { VerifyEmailButton } from "./person/VerifyEmailButton";

export async function CapitalFirmPage({ id }: { id: string }) {
  const core = createCoreClient();
  const engage = createEngageClient();
  const { data: firm } = await core
    .from("firms")
    .select("id, canonical_name, website_domain, sectors, dnc, dnc_reason, notes")
    .eq("id", id)
    .maybeSingle();
  if (!firm) notFound();
  const [{ data: people }, { data: parts }] = await Promise.all([
    core.from("people").select("id, full_name, email, email_state, dnc").eq("firm_id", id),
    engage
      .from("participations")
      .select("id, stage, status_note, mandate_id, mandates:mandate_id ( code, company_name )")
      .eq("firm_id", id),
  ]);
  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>{firm.canonical_name}</h1>
          <p>
            {firm.website_domain ?? "No website"}
            {firm.dnc ? " · Do not contact" : ""}.
          </p>
        </div>
        <Link className="btn" href="/today">
          Today
        </Link>
      </div>
      {firm.dnc ? (
        <div className="warn-banner">
          <strong>Do not contact.</strong> {firm.dnc_reason}
        </div>
      ) : null}
      <div className="grid-2">
        <div className="card">
          <h2>People</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {(people ?? []).map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/person/${p.id}`}>{p.full_name}</Link>
                  </td>
                  <td>{p.email ?? "—"}</td>
                  <td>
                    <span className={badgeClassForEmailState(p.email_state)}>
                      {badgeForEmailState(p.email_state)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Raises</h2>
          <table>
            <thead>
              <tr>
                <th>Raise</th>
                <th>Stage</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {(parts ?? []).map((p) => {
                const m = p.mandates as { code?: string; company_name?: string } | { code?: string; company_name?: string }[] | null;
                const md = Array.isArray(m) ? m[0] : m;
                return (
                  <tr key={p.id}>
                    <td>
                      {md?.company_name} ({md?.code})
                    </td>
                    <td>{p.stage}</td>
                    <td>{p.status_note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export async function CapitalPersonPage({ id }: { id: string }) {
  const core = createCoreClient();
  const engage = createEngageClient();
  const { data: person } = await core
    .from("people")
    .select("id, full_name, email, email_state, dnc, dnc_reason, firm_id, firms:firm_id ( canonical_name )")
    .eq("id", id)
    .maybeSingle();
  if (!person) notFound();
  const firm = person.firms as { canonical_name?: string } | { canonical_name?: string }[] | null;
  const firmName = Array.isArray(firm) ? firm[0]?.canonical_name : firm?.canonical_name;
  const { data: parts } = await engage
    .from("participations")
    .select("id, stage, status_note, mandates:mandate_id ( code, company_name )")
    .eq("person_id", id);
  const { data: links } = await engage
    .from("activity_links")
    .select("activity_id")
    .eq("entity_type", "person")
    .eq("entity_id", id)
    .limit(50);
  const actIds = (links ?? []).map((l) => l.activity_id);
  const { data: acts } = actIds.length
    ? await engage
        .from("activities")
        .select("id, occurred_at, channel, subject")
        .in("id", actIds)
        .order("occurred_at", { ascending: false })
        .limit(30)
    : { data: [] };
  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>{person.full_name}</h1>
          <p>
            {firmName ?? "No firm"}
            {person.email ? ` · ${person.email}` : ""}
            {person.dnc ? " · Do not contact" : ""}.
          </p>
          <p>
            <span className={badgeClassForEmailState(person.email_state)}>
              {badgeForEmailState(person.email_state)}
            </span>
          </p>
        </div>
        <div className="btn-row" style={{ margin: 0 }}>
          {person.email ? <VerifyEmailButton personId={person.id} /> : null}
          {person.firm_id ? (
            <Link className="btn" href={`/firm/${person.firm_id}`}>
              Firm
            </Link>
          ) : null}
        </div>
      </div>
      {person.dnc ? (
        <div className="warn-banner">
          <strong>Do not contact.</strong> {person.dnc_reason}
        </div>
      ) : null}
      <div className="grid-2">
        <div className="card">
          <h2>Raises</h2>
          <ul>
            {(parts ?? []).map((p) => {
              const m = p.mandates as { code?: string; company_name?: string } | { code?: string; company_name?: string }[] | null;
              const md = Array.isArray(m) ? m[0] : m;
              return (
                <li key={p.id}>
                  {md?.company_name} · {p.stage}
                  {p.status_note ? ` — ${p.status_note}` : ""}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="card">
          <h2>Timeline</h2>
          <ul>
            {(acts ?? []).map((a) => (
              <li key={a.id}>
                {a.occurred_at?.slice(0, 10)} · {a.channel} · {a.subject}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
