import Link from "next/link";
import { listCollisions } from "@/lib/capital/collision";
import { evaluateDraftGate, lastThreadsForPeople } from "@/lib/capital/draft-gate";
import type { MandateCode } from "@/lib/capital/mandates";
import { badgeClassForEmailState, badgeForEmailState } from "@/lib/capital/neverbounce";
import { createCoreClient, createEngageClient } from "@/lib/supabase/capital";
import { SendBookClient, type SendRow } from "./SendBookClient";

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
        <h1>Unknown programme {code}</h1>
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
  const [allCollisions, threads] = await Promise.all([
    listCollisions(),
    lastThreadsForPeople(personIds),
  ]);

  const rows: SendRow[] = [];
  for (const p of parts ?? []) {
    const firm = p.firm_id ? firmById[p.firm_id] : null;
    const person = p.person_id ? personById[p.person_id] : null;
    const gate = await evaluateDraftGate({
      personId: p.person_id,
      firmId: p.firm_id,
      mandateCode: code as MandateCode,
      stage: p.stage,
      lastThread: p.person_id ? threads.get(p.person_id) ?? null : null,
      person: person ?? null,
      firm: firm ?? null,
      mandateStatus: mandate.status,
      collisions: allCollisions.filter((c) => {
        if (c.mandate_a !== code && c.mandate_b !== code) return false;
        if (p.person_id && c.person_id === p.person_id) return true;
        if (p.firm_id && c.firm_id === p.firm_id) return true;
        return false;
      }),
    });
    rows.push({
      participationId: p.id,
      firmId: p.firm_id,
      personId: p.person_id,
      firmName: firm?.canonical_name ?? "—",
      personName: person?.full_name ?? "—",
      email: person?.email ?? null,
      stage: p.stage,
      emailState: person?.email_state ?? null,
      badge: badgeForEmailState(person?.email_state),
      badgeClass: badgeClassForEmailState(person?.email_state),
      allowed: gate.allowed,
      why: gate.why,
      warm: gate.warm,
      lastSubject: gate.lastThread?.subject ?? null,
      collision: gate.collisions[0]
        ? `also on ${gate.collisions[0].mandate_a === code ? gate.collisions[0].mandate_b : gate.collisions[0].mandate_a} ${gate.collisions[0].days_apart}d ago`
        : null,
    });
  }

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>
            Send — {mandate.company_name} ({mandate.code})
          </h1>
          <p>
            {mandate.ask_summary}. Drafts go to Gmail drafts. Nothing auto-sends.
            {mandate.status === "paused" ? " This raise is paused." : ""}
          </p>
        </div>
        <div className="btn-row" style={{ margin: 0 }}>
          <Link className="btn" href={`/sign-off?code=${mandate.code}`}>
            Sign-off
          </Link>
          <Link className="btn" href="/send">
            All raises
          </Link>
        </div>
      </div>
      {mandate.narrative_notes ? (
        <div className="note" style={{ marginBottom: 16 }}>
          {mandate.narrative_notes}
        </div>
      ) : null}
      <SendBookClient code={code as MandateCode} rows={rows} />
    </div>
  );
}
