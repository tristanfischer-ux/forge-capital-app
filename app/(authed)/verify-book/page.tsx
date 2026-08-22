import Link from "next/link";
import { createCoreClient, createEngageClient } from "@/lib/supabase/capital";
import { badgeClassForEmailState, badgeForEmailState } from "@/lib/capital/neverbounce";
import { VerifyEmailButton } from "../person/VerifyEmailButton";

export const dynamic = "force-dynamic";

export default async function VerifyBookPage() {
  const engage = createEngageClient();
  const core = createCoreClient();
  const { data: parts } = await engage
    .from("participations")
    .select("person_id")
    .in("stage", ["approved", "approached", "responded", "meeting", "awaiting_signoff"])
    .not("person_id", "is", null)
    .limit(400);
  const ids = [...new Set((parts ?? []).map((p) => p.person_id).filter(Boolean))] as string[];
  const { data: people } = ids.length
    ? await core
        .from("people")
        .select("id, full_name, email, email_state, firms:firm_id ( canonical_name )")
        .in("id", ids)
        .not("email", "is", null)
        .in("email_state", ["unknown", "inferred", "generic"])
        .limit(80)
    : { data: [] };

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Verify emails</h1>
          <p>
            People already on a raise whose address is not yet verified.
            Rule 13: no draft until NeverBounce says valid. Generic inboxes
            stay blocked.
          </p>
        </div>
        <Link className="btn" href="/chasers">
          Chasers
        </Link>
      </div>
      <div className="card">
        {(people ?? []).length === 0 ? (
          <p className="sub">No unverified addresses on active raises.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Firm</th>
                <th>Email</th>
                <th>State</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(people ?? []).map((p) => {
                const firm = p.firms as { canonical_name?: string } | { canonical_name?: string }[] | null;
                const firmName = Array.isArray(firm) ? firm[0]?.canonical_name : firm?.canonical_name;
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/person/${p.id}`}>{p.full_name}</Link>
                    </td>
                    <td>{firmName ?? "—"}</td>
                    <td>{p.email}</td>
                    <td>
                      <span className={badgeClassForEmailState(p.email_state)}>
                        {badgeForEmailState(p.email_state)}
                      </span>
                    </td>
                    <td>
                      <VerifyEmailButton personId={p.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
