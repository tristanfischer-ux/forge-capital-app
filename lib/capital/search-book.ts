import { createCoreClient } from "@/lib/supabase/capital";

export type BookHit = {
  kind: "firm" | "person";
  id: string;
  firm_id?: string | null;
  label: string;
  sub: string;
  score: number;
};

function tokens(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9@._+\- ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 6);
}

function scoreText(hay: string, parts: string[], raw: string): number {
  const h = hay.toLowerCase();
  if (!h) return 0;
  if (h === raw) return 100;
  if (h.startsWith(raw)) return 80;
  if (h.includes(raw)) return 60;
  let s = 0;
  for (const p of parts) {
    if (h === p) s += 40;
    else if (h.startsWith(p)) s += 24;
    else if (h.includes(p)) s += 16;
  }
  return s;
}

function emailLocalAsName(email: string | null | undefined): string {
  if (!email || !email.includes("@")) return "";
  return email.split("@")[0].replace(/[._+\-]+/g, " ");
}

export async function searchBook(q: string): Promise<BookHit[]> {
  const raw = q.trim().toLowerCase();
  if (raw.length < 2) return [];
  const parts = tokens(raw);
  const core = createCoreClient();
  const orFirm = parts.map((p) => `canonical_name.ilike.%${p}%,website_domain.ilike.%${p}%`).join(",");
  const orPeople = parts
    .map((p) => `full_name.ilike.%${p}%,email.ilike.%${p}%,role_title.ilike.%${p}%`)
    .join(",");

  const [firms, people] = await Promise.all([
    core
      .from("firms")
      .select("id, canonical_name, website_domain, sectors, dnc")
      .or(orFirm || `canonical_name.ilike.%${raw}%`)
      .limit(40),
    core
      .from("people")
      .select("id, full_name, email, firm_id, dnc, role_title, firms:firm_id ( canonical_name )")
      .or(orPeople || `full_name.ilike.%${raw}%,email.ilike.%${raw}%`)
      .limit(40),
  ]);

  const hits: BookHit[] = [];
  for (const f of firms.data ?? []) {
    const label = f.canonical_name ?? "";
    const score = scoreText(`${label} ${f.website_domain ?? ""}`, parts, raw);
    if (score <= 0) continue;
    hits.push({
      kind: "firm",
      id: f.id,
      label,
      sub: [f.website_domain, f.dnc ? "DNC" : null, Array.isArray(f.sectors) ? f.sectors[0] : null]
        .filter(Boolean)
        .join(" · "),
      score,
    });
  }
  for (const p of people.data ?? []) {
    const firm = p.firms as { canonical_name?: string } | { canonical_name?: string }[] | null;
    const firmName = Array.isArray(firm) ? firm[0]?.canonical_name : firm?.canonical_name;
    const local = emailLocalAsName(p.email);
    const hay = `${p.full_name ?? ""} ${p.email ?? ""} ${local} ${firmName ?? ""} ${p.role_title ?? ""}`;
    let score = scoreText(hay, parts, raw);
    // "Josh Wolfe" must hit josh.wolfe@ even when the name on the row is wrong.
    if (local && parts.length >= 2 && local.includes(parts.join(" "))) score = Math.max(score, 90);
    if (p.email && raw.includes("@") && p.email.toLowerCase().includes(raw)) score = Math.max(score, 95);
    if (score <= 0) continue;
    hits.push({
      kind: "person",
      id: p.id,
      firm_id: p.firm_id,
      label: p.full_name ?? "—",
      sub: [firmName, p.email, p.dnc ? "DNC" : null].filter(Boolean).join(" · "),
      score,
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 25);
}
