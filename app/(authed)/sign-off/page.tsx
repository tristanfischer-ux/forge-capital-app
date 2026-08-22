import Link from "next/link";
import { MANDATE_OPTIONS, type MandateCode } from "@/lib/capital/mandates";
import { createCoreClient, createEngageClient } from "@/lib/supabase/capital";
import { SignOffClient } from "./SignOffClient";
import type { SignOffLine } from "./actions";

export const dynamic = "force-dynamic";

export default async function SignOffPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const code = ((await searchParams).code ?? "SS").toUpperCase() as MandateCode;
  const engage = createEngageClient();
  const core = createCoreClient();
  const { data: mandate } = await engage
    .from("mandates")
    .select("id, code, company_name, status, principal_name")
    .eq("code", code)
    .maybeSingle();
  if (!mandate) {
    return (
      <div className="wrap">
        <h1>Unknown programme</h1>
      </div>
    );
  }
  const { data: parts } = await engage
    .from("participations")
    .select("id, person_id, firm_id, stage, status_note")
    .eq("mandate_id", mandate.id)
    .in("stage", ["research", "awaiting_signoff"])
    .order("updated_at", { ascending: false })
    .limit(80);

  const firmIds = [...new Set((parts ?? []).map((p) => p.firm_id).filter(Boolean))] as string[];
  const personIds = [...new Set((parts ?? []).map((p) => p.person_id).filter(Boolean))] as string[];
  const [{ data: firms }, { data: people }] = await Promise.all([
    firmIds.length
      ? core.from("firms").select("id, canonical_name, website_domain").in("id", firmIds)
      : Promise.resolve({ data: [] }),
    personIds.length
      ? core.from("people").select("id, full_name").in("id", personIds)
      : Promise.resolve({ data: [] }),
  ]);
  const firmById = Object.fromEntries((firms ?? []).map((f) => [f.id, f]));
  const personById = Object.fromEntries((people ?? []).map((p) => [p.id, p]));
  const lines: SignOffLine[] = (parts ?? []).map((p, i) => {
    const firm = p.firm_id ? firmById[p.firm_id] : null;
    const person = p.person_id ? personById[p.person_id] : null;
    return {
      n: i + 1,
      participationId: p.id,
      firmId: p.firm_id,
      personId: p.person_id,
      firmName: firm?.canonical_name ?? "Unknown firm",
      website: firm?.website_domain ?? null,
      personName: person?.full_name ?? null,
      stage: p.stage,
    };
  });

  const principal = mandate.principal_name || "the principal";

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Sign-off — {mandate.company_name}</h1>
          <p>
            Generate the numbered list. Paste the reply. Principals never see
            this app.
          </p>
        </div>
        <Link className="btn" href={`/send/${code}`}>
          Send
        </Link>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <label className="faint">Raise</label>
        <div className="btn-row">
          {MANDATE_OPTIONS.map((m) => (
            <Link
              key={m.code}
              className={m.code === code ? "btn btn-primary" : "btn"}
              href={`/sign-off?code=${m.code}`}
            >
              {m.label}
            </Link>
          ))}
        </div>
      </div>
      <SignOffClient code={code} principal={principal} lines={lines} />
    </div>
  );
}
