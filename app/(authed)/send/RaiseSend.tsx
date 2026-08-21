import Link from "next/link";
import { createCoreClient, createEngageClient } from "@/lib/supabase/capital";

export async function RaiseSend({ code }: { code: string }) {
  const engage = createEngageClient();
  const core = createCoreClient();
  const { data: mandate } = await engage
    .from("mandates")
    .select("id, code, company_name, status, narrative_notes, ask_summary")
    .eq("code", code)
    .maybeSingle();
  if (!mandate) {
    return (
      <div className="wrap">
        <h1>Unknown raise {code}</h1>
        <Link href="/send">Back</Link>
      </div>
    );
  }
  const { data: parts } = await engage
    .from("participations")
    .select("id, stage, status_note, person_id, firm_id")
    .eq("mandate_id", mandate.id)
    .order("updated_at", { ascending: false })
    .limit(200);

  const personIds = [...new Set((parts ?? []).map((p) => p.person_id).filter(Boolean))] as string[];
  const firmIds = [...new Set((parts ?? []).map((p) => p.firm_id).filter(Boolean))] as string[];
  const [{ data: people }, { data: firms }] = await Promise.all([
    personIds.length
      ? core.from("people").select("id, full_name, email, email_state, dnc").in("id", personIds)
      : Promise.resolve({ data: [] }),
    firmIds.length
      ? core.from("firms").select("id, canonical_name, dnc").in("id", firmIds)
      : Promise.resolve({ data: [] }),
  ]);
  const personById = Object.fromEntries((people ?? []).map((p) => [p.id, p]));
  const firmById = Object.fromEntries((firms ?? []).map((f) => [f.id, f]));

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>
            Send — {mandate.company_name} ({mandate.code})
          </h1>
          <p>
            {mandate.ask_summary}. Drafts only. Nothing auto-sends.
            {mandate.status === "paused" ? " This raise is paused." : ""}
          </p>
        </div>
        <Link className="btn" href="/send">
          All raises
        </Link>
      </div>
      {mandate.narrative_notes ? (
        <div className="note" style={{ marginBottom: 16 }}>
          {mandate.narrative_notes}
        </div>
      ) : null}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Firm</th>
              <th>Person</th>
              <th>Email</th>
              <th>Stage</th>
              <th>May draft?</th>
            </tr>
          </thead>
          <tbody>
            {(parts ?? []).map((p) => {
              const firm = p.firm_id ? firmById[p.firm_id] : null;
              const person = p.person_id ? personById[p.person_id] : null;
              const blocked =
                firm?.dnc ||
                person?.dnc ||
                !person ||
                person.email_state !== "verified";
              const why = firm?.dnc
                ? "firm DNC"
                : person?.dnc
                  ? "person DNC"
                  : !person
                    ? "no named person"
                    : person.email_state !== "verified"
                      ? `email ${person.email_state ?? "unknown"} — not verified`
                      : "ok";
              return (
                <tr key={p.id}>
                  <td>{firm?.canonical_name ?? "—"}</td>
                  <td>{person?.full_name ?? "—"}</td>
                  <td>{person?.email ?? "—"}</td>
                  <td>{p.stage}</td>
                  <td>{blocked ? why : "Yes — create the draft in Gmail yourself. The desk does not send."}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
