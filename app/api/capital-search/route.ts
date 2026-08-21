import { NextRequest, NextResponse } from "next/server";
import { isAllowedSignInEmail } from "@/lib/auth-allowlist";
import { createCoreClient, capitalConfigured } from "@/lib/supabase/capital";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await createServerClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user || !isAllowedSignInEmail(user.email)) {
    return NextResponse.json({ hits: [] }, { status: 401 });
  }
  if (!capitalConfigured()) {
    return NextResponse.json({ hits: [], error: "shared book not configured" });
  }
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ hits: [] });
  const core = createCoreClient();
  const like = `%${q}%`;
  const [firms, people] = await Promise.all([
    core
      .from("firms")
      .select("id, canonical_name, website_domain, sectors, dnc")
      .or(`canonical_name.ilike.${like},website_domain.ilike.${like}`)
      .limit(25),
    core
      .from("people")
      .select("id, full_name, email, firm_id, dnc, firms:firm_id ( canonical_name )")
      .or(`full_name.ilike.${like},email.ilike.${like}`)
      .limit(15),
  ]);
  const hits = [];
  for (const f of firms.data ?? []) {
    hits.push({
      kind: "firm",
      id: f.id,
      label: f.canonical_name,
      sub: [f.website_domain, f.dnc ? "DNC" : null, Array.isArray(f.sectors) ? f.sectors[0] : null]
        .filter(Boolean)
        .join(" · "),
    });
  }
  for (const p of people.data ?? []) {
    const firm = p.firms as { canonical_name?: string } | { canonical_name?: string }[] | null;
    const firmName = Array.isArray(firm) ? firm[0]?.canonical_name : firm?.canonical_name;
    hits.push({
      kind: "person",
      id: p.id,
      firm_id: p.firm_id,
      label: p.full_name,
      sub: [firmName, p.email, p.dnc ? "DNC" : null].filter(Boolean).join(" · "),
    });
  }
  return NextResponse.json({ hits });
}
