import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ hits: [] });

  const supabase = await createServerClient();
  const like = `%${q}%`;
  const [people, firms] = await Promise.all([
    supabase
      .from("partners_mirror")
      .select("id, name, title, investors_mirror:investor_id ( firm_name )")
      .ilike("name", like)
      .limit(6),
    supabase
      .from("investors_mirror")
      .select("id, firm_name, hq_location")
      .ilike("firm_name", like)
      .limit(6),
  ]);

  const hits: { kind: "person" | "firm"; id: number; label: string; sub: string | null }[] = [];
  for (const p of people.data ?? []) {
    const raw = p as unknown as {
      id: number;
      name: string | null;
      title: string | null;
      investors_mirror: { firm_name: string | null } | { firm_name: string | null }[] | null;
    };
    const firm = Array.isArray(raw.investors_mirror)
      ? raw.investors_mirror[0]
      : raw.investors_mirror;
    hits.push({
      kind: "person",
      id: raw.id,
      label: raw.name ?? `Person ${raw.id}`,
      sub: [raw.title, firm?.firm_name].filter(Boolean).join(" · ") || null,
    });
  }
  for (const f of firms.data ?? []) {
    hits.push({
      kind: "firm",
      id: f.id as number,
      label: (f.firm_name as string | null) ?? `Firm ${f.id}`,
      sub: (f.hq_location as string | null) ?? null,
    });
  }
  return NextResponse.json({ hits });
}
