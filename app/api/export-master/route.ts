import { createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("campaign_partners")
    .select(
      `id, status_code, status_label, status_raw, permission_status, last_contact_at, import_needs_review,
       partners_mirror:partner_id ( name, email, investors_mirror:investor_id ( firm_name, website ) ),
       campaigns:campaign_id ( name )`,
    )
    .order("last_contact_at", { ascending: false })
    .limit(20000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const generated = new Date().toISOString();
  const longRows = (data ?? []).map((raw) => {
    const row = raw as unknown as {
      id: string;
      status_code: string | null;
      status_label: string | null;
      status_raw: string | null;
      permission_status: string | null;
      last_contact_at: string | null;
      import_needs_review: boolean | null;
      partners_mirror: {
        name: string | null;
        email?: string | null;
        investors_mirror: { firm_name: string | null; website: string | null } | null;
      } | null;
      campaigns: { name: string | null } | null;
    };
    return {
      generated_at: generated,
      snapshot: "edit in the desk — not canonical",
      campaign: row.campaigns?.name ?? "",
      firm: row.partners_mirror?.investors_mirror?.firm_name ?? "",
      website: row.partners_mirror?.investors_mirror?.website ?? "",
      contact: row.partners_mirror?.name ?? "",
      email: row.partners_mirror?.email ?? "",
      status_code: row.status_code ?? "",
      status_label: row.status_label ?? "",
      permission_status: row.permission_status ?? "",
      last_contact_at: row.last_contact_at ?? "",
      status_raw: row.status_raw ?? "",
      import_needs_review: row.import_needs_review ? "yes" : "",
      campaign_partner_id: row.id,
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(longRows);
  XLSX.utils.book_append_sheet(wb, ws, "By raise");
  const banner = XLSX.utils.aoa_to_sheet([
    ["SNAPSHOT — edit in the raise desk, not this file"],
    ["generated_at", generated],
    ["rows", longRows.length],
    ["filename must never contain CANONICAL"],
  ]);
  XLSX.utils.book_append_sheet(wb, banner, "README");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const day = generated.slice(0, 10);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Master Investor Tracker TF ${day} snapshot.xlsx"`,
    },
  });
}
