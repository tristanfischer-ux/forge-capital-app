import { redirect } from "next/navigation";
import { getDeskToday } from "@/lib/queries/desk-today";
import { getPartnerProfile } from "@/lib/queries/partner-profile";

export const dynamic = "force-dynamic";

export default async function FirmIndexPage() {
  const data = await getDeskToday();
  const pid = data.doubleAsks[0]?.partner_id ?? data.approvals.find((a) => a.partner_id)?.partner_id;
  if (pid) {
    const p = await getPartnerProfile(pid);
    if (p?.firm?.id) redirect(`/firm/${p.firm.id}`);
  }
  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Firm</h1>
        <p>Open a firm from a person page. This is the encyclopaedia view plus every raise already touching the fund.</p>
      </div>
    </div>
  );
}
