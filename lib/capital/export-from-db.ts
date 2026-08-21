import * as XLSX from "xlsx";
import { createCoreClient, createEngageClient } from "@/lib/supabase/capital";

async function allRows<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  table: string,
  select: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await client.from(table).select(select).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

type Firm = {
  id: string;
  canonical_name: string | null;
  website_domain: string | null;
  sectors: string[] | string | null;
  dnc: boolean | null;
};
type Person = {
  id: string;
  firm_id: string | null;
  full_name: string | null;
  email: string | null;
  email_state: string | null;
  dnc: boolean | null;
  linkedin_url: string | null;
  role_title: string | null;
  provenance: string | null;
};
type Part = {
  firm_id: string | null;
  person_id: string | null;
  mandate_id: string | null;
  stage: string | null;
  status_note: string | null;
  first_sent: string | null;
  latest_touch: string | null;
};

export async function buildCanonicalWorkbook(): Promise<Buffer> {
  const core = createCoreClient();
  const engage = createEngageClient();
  const [firms, people, parts, mandates] = await Promise.all([
    allRows<Firm>(core, "firms", "id,canonical_name,website_domain,sectors,dnc"),
    allRows<Person>(
      core,
      "people",
      "id,firm_id,full_name,email,email_state,dnc,linkedin_url,role_title,provenance",
    ),
    allRows<Part>(
      engage,
      "participations",
      "firm_id,person_id,mandate_id,stage,status_note,first_sent,latest_touch",
    ),
    allRows<{ id: string; code: string }>(engage, "mandates", "id,code"),
  ]);
  const codeBy = Object.fromEntries(mandates.map((m) => [m.id, m.code]));
  const firmsBy = Object.fromEntries(firms.map((f) => [f.id, f]));
  const peopleBy = Object.fromEntries(people.map((p) => [p.id, p]));
  const peopleByFirm = new Map<string, Person[]>();
  for (const p of people) {
    if (!p.firm_id) continue;
    const list = peopleByFirm.get(p.firm_id) ?? [];
    list.push(p);
    peopleByFirm.set(p.firm_id, list);
  }
  const partsByFirm = new Map<string, Part[]>();
  for (const p of parts) {
    if (!p.firm_id) continue;
    const list = partsByFirm.get(p.firm_id) ?? [];
    list.push(p);
    partsByFirm.set(p.firm_id, list);
  }

  const generated = new Date().toISOString();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Shared-book backup — generated from Corpus"],
      [generated],
      [`Firms ${firms.length} · people ${people.length} · participations ${parts.length}`],
      ["The 17 Aug original was not modified."],
    ]),
    "Dashboard",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Generated from the shared book. Excel is a download only."],
      ["Do not type in the 17 Aug CANONICAL file."],
    ]),
    "README",
  );

  const codes = ["SK", "FF", "PA", "SS", "CA", "US", "OD", "HO"];
  const header1 = [
    "LAST CONTACT",
    "CONTACTED?",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "INVESTOR INFO",
  ];
  const header2 = [
    "Days ago",
    "SkySails",
    "FishFrom",
    "Panatere",
    "Space Solar",
    "Casper",
    "US Arb",
    "Odysseus",
    "Hooley",
    "Investor",
    "Website",
    "Contact",
    "Email",
    "Sector",
    "Raises",
  ];
  const master: (string | number | null)[][] = [header1, header2];
  const sorted = [...firms].sort((a, b) =>
    (a.canonical_name ?? "").localeCompare(b.canonical_name ?? "", "en"),
  );
  for (const f of sorted) {
    const plist = peopleByFirm.get(f.id) ?? [];
    const named = plist.find((p) => !p.dnc) ?? plist[0];
    const pp = partsByFirm.get(f.id) ?? [];
    const byCode: Record<string, Part> = {};
    for (const p of pp) {
      const c = p.mandate_id ? codeBy[p.mandate_id] : null;
      if (c) byCode[c] = p;
    }
    const row: (string | number | null)[] = [
      null,
      ...codes.map((c) => (byCode[c] ? "✓" : null)),
      f.canonical_name,
      f.website_domain,
      named?.full_name ?? null,
      named?.email ?? null,
      Array.isArray(f.sectors) ? f.sectors.join(", ") : f.sectors,
      pp.length || null,
    ];
    master.push(row);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(master), "Master Tracker");

  const odId = mandates.find((m) => m.code === "OD")?.id;
  const usId = mandates.find((m) => m.code === "US")?.id;
  const odParts = parts.filter((p) => p.mandate_id === odId);
  const usParts = parts.filter((p) => p.mandate_id === usId);
  const doNot = odParts.filter(
    (p) =>
      ["disqualified", "blocked", "closed_lost"].includes(p.stage ?? "") ||
      /do not/i.test(p.status_note ?? ""),
  );
  const low = odParts.filter((p) => /cautious/i.test(p.status_note ?? ""));
  const cands = odParts.filter((p) => ["research", "awaiting_signoff"].includes(p.stage ?? ""));

  const odAoA = (list: Part[]) =>
    list.map((p) => [
      p.firm_id ? firmsBy[p.firm_id]?.canonical_name : null,
      p.firm_id ? firmsBy[p.firm_id]?.website_domain : null,
      p.stage,
      (p.latest_touch || p.first_sent || "").slice(0, 10) || null,
      p.status_note,
      p.person_id ? peopleBy[p.person_id]?.full_name : null,
      p.person_id ? peopleBy[p.person_id]?.email : null,
    ]);

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Firm", "Contact", "Email", "Batch", "Stage", "Converted", "Notes"],
      ...usParts.map((p) => [
        p.firm_id ? firmsBy[p.firm_id]?.canonical_name : null,
        p.person_id ? peopleBy[p.person_id]?.full_name : null,
        p.person_id ? peopleBy[p.person_id]?.email : null,
        "book",
        p.stage,
        "",
        p.status_note,
      ]),
    ]),
    "US Exploration (Forge)",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["Investor", "Website", "Stage", "Latest", "Notes", "Contact", "Email"], ...odAoA(odParts)]),
    "Odysseus — Jordan full",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["Investor", "Website", "Stage", "Latest", "Notes", "Contact", "Email"], ...odAoA(doNot)]),
    "Odysseus — DO NOT outreach",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["Investor", "Website", "Stage", "Latest", "Notes", "Contact", "Email"], ...odAoA(low)]),
    "Odysseus — Low priority OK",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Investor", "Website", "Contact", "Notes"],
      ...cands.map((p) => [
        p.firm_id ? firmsBy[p.firm_id]?.canonical_name : null,
        p.firm_id ? firmsBy[p.firm_id]?.website_domain : null,
        p.person_id ? peopleBy[p.person_id]?.full_name : null,
        p.status_note,
      ]),
    ]),
    "Odysseus — Candidates approval",
  );
  const li = people.filter((p) => (p.provenance ?? "").toLowerCase() === "linkedin");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Name", "Firm", "Position", "LinkedIn URL", "Connected On", "Email", "In Master Tracker"],
      ...li.map((p) => [
        p.full_name,
        p.firm_id ? firmsBy[p.firm_id]?.canonical_name : null,
        p.role_title,
        p.linkedin_url,
        "",
        p.email,
        p.firm_id && partsByFirm.has(p.firm_id) ? "yes" : "no",
      ]),
    ]),
    "LinkedIn Connections",
  );

  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return out;
}
