import { NextResponse, type NextRequest } from "next/server";
import {
  loadAliases,
  loadRegistry,
  lookupRegistry,
  normalizeFirmName,
  roleLabel,
} from "@/lib/desk/identity";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ hits: [] });

  const session = await createServerClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return NextResponse.json({ hits: [] });
  // Desk search is Tristan-only; the encyclopaedia join under anon RLS
  // often returns an empty set. Service role after a session check.
  const supabase = createAdminClient();
  const like = `%${q}%`;
  const looksEmail = q.includes("@") || q.includes(".");
  const [people, peopleEmail, firms] = await Promise.all([
    supabase
      .from("partners_mirror")
      .select("id, name, title, email, investors_mirror:investor_id ( firm_name )")
      .ilike("name", like)
      .limit(6),
    looksEmail
      ? supabase
          .from("partners_mirror")
          .select("id, name, title, email, investors_mirror:investor_id ( firm_name )")
          .ilike("email", like)
          .limit(6)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase
      .from("investors_mirror")
      .select("id, firm_name, hq_location")
      .ilike("firm_name", like)
      .limit(6),
  ]);

  const hits: { kind: "person" | "firm"; id: number; label: string; sub: string | null }[] = [];
  const seen = new Set<string>();

  const aliasHit = loadAliases().find(
    (a) =>
      a.dirty.toLowerCase().includes(q.toLowerCase()) ||
      a.clean.toLowerCase().includes(q.toLowerCase()),
  );
  if (aliasHit) {
    const { data: aliased } = await supabase
      .from("investors_mirror")
      .select("id, firm_name, hq_location")
      .ilike("firm_name", `%${aliasHit.clean}%`)
      .limit(3);
    for (const f of aliased ?? []) {
      const id = f.id as number;
      seen.add(`firm-${id}`);
      hits.push({
        kind: "firm",
        id,
        label: normalizeFirmName((f.firm_name as string) ?? aliasHit.clean),
        sub: `also filed as ${aliasHit.dirty}`,
      });
    }
  }

  type PersonRow = {
    id: number;
    name: string | null;
    title: string | null;
    email?: string | null;
    investors_mirror: { firm_name: string | null } | { firm_name: string | null }[] | null;
  };

  for (const p of [...(people.data ?? []), ...(peopleEmail.data ?? [])]) {
    const raw = p as unknown as PersonRow;
    const key = `person-${raw.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const firm = Array.isArray(raw.investors_mirror)
      ? raw.investors_mirror[0]
      : raw.investors_mirror;
    const role = lookupRegistry({ name: raw.name, email: raw.email });
    hits.push({
      kind: "person",
      id: raw.id,
      label: raw.name ?? `Person ${raw.id}`,
      sub:
        [role ? roleLabel(role.role) : null, raw.title, firm?.firm_name, raw.email]
          .filter(Boolean)
          .join(" · ") || null,
    });
  }

  for (const f of firms.data ?? []) {
    const id = f.id as number;
    if (seen.has(`firm-${id}`)) continue;
    seen.add(`firm-${id}`);
    hits.push({
      kind: "firm",
      id,
      label: normalizeFirmName((f.firm_name as string | null) ?? `Firm ${f.id}`),
      sub: (f.hq_location as string | null) ?? null,
    });
  }

  for (const r of loadRegistry()) {
    const blob = `${r.name} ${r.email ?? ""} ${(r.emails ?? []).join(" ")} ${r.firm ?? ""}`.toLowerCase();
    if (!blob.includes(q.toLowerCase())) continue;
    if (r.partner_id && seen.has(`person-${r.partner_id}`)) continue;
    hits.push({
      kind: "person",
      id: r.partner_id ?? 0,
      label: r.name,
      sub: [roleLabel(r.role), r.firm, r.email].filter(Boolean).join(" · "),
    });
  }

  return NextResponse.json({ hits: hits.slice(0, 12) });
}
