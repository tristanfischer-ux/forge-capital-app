import { redirect } from "next/navigation";
import { getDeskToday } from "@/lib/queries/desk-today";

export const dynamic = "force-dynamic";

export default async function PersonIndexPage() {
  const data = await getDeskToday();
  const first = data.doubleAsks[0] ?? data.approvals.find((a) => a.partner_id)?.partner_id;
  if (typeof first === "object" && first.partner_id) {
    redirect(`/person/${first.partner_id}`);
  }
  if (typeof first === "number") redirect(`/person/${first}`);
  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Person</h1>
        <p>Open a person from Today or Company. This page is the operator surface for one investor across every raise.</p>
      </div>
    </div>
  );
}
