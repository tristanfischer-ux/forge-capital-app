import Link from "next/link";
import { capitalConfigured, createEngageClient } from "@/lib/supabase/capital";

export const dynamic = "force-dynamic";

export default async function SendIndexPage() {
  if (!capitalConfigured()) {
    return (
      <div className="wrap">
        <h1>Send</h1>
        <p>Shared book is not configured.</p>
      </div>
    );
  }
  const engage = createEngageClient();
  const { data: mandates } = await engage
    .from("mandates")
    .select("code, company_name, status, narrative_notes, ask_summary")
    .order("code");
  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Send — from the shared book</h1>
          <p>
            Pick a raise. Drafts go to Gmail drafts. Nothing auto-sends.
            The old encyclopaedia campaign flow is not used here.
          </p>
        </div>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Company</th>
              <th>Status</th>
              <th>Ask</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(mandates ?? []).map((m) => (
              <tr key={m.code}>
                <td>{m.code}</td>
                <td>{m.company_name}</td>
                <td>{m.status}</td>
                <td>{m.ask_summary}</td>
                <td>
                  <Link className="btn btn-primary" href={`/send/${m.code}`}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
