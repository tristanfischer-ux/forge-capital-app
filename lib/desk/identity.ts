import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type PersonRole =
  | "investor"
  | "principal"
  | "adviser"
  | "service"
  | "personal"
  | "ned";

export interface RegistryPerson {
  name: string;
  email?: string;
  emails?: string[];
  role: PersonRole;
  firm?: string;
  mandate?: string;
  notes?: string;
  partner_id?: number;
  firm_id?: number;
}

export interface FirmAlias {
  dirty: string;
  clean: string;
  firm_id?: number;
}

const GENERIC_LOCAL =
  /^(info|contact|hello|enquiries|enquiries|investproposals|investment|general|invest|investments|office|team|ventures|funding|partners|deals|pitch|applications|mail|admin|secretary|ir|investor|investors|submissions|submit|startup|startups|apply)$/i;

export const SEEDED_REGISTRY: RegistryPerson[] = [
  { name: "Richard Winslade", email: "richard@spacesolar.co", role: "principal", firm: "Space Solar", mandate: "Space Solar" },
  { name: "Jordan Vannitsen", email: "j.vannitsen@odysseusspace.com", role: "principal", firm: "Odysseus Space", mandate: "Odysseus Space" },
  { name: "Tony Hooley", email: "Tony@hooleyresearch.co.uk", role: "principal", firm: "Hooley RF", mandate: "Hooley RF" },
  { name: "Stephan Wrage", role: "principal", firm: "SkySails Power", mandate: "SkySails Power" },
  { name: "Andrew Robertson", role: "principal", firm: "FishFrom Technologies", mandate: "FishFrom Technologies" },
  { name: "Andreas Cser", email: "acser@fraserfinance.com", role: "adviser", firm: "Fraser Finance", mandate: "Panatere" },
  { name: "Philipp Kobus", email: "pkobus@fraserfinance.com", role: "adviser", firm: "Fraser Finance" },
  { name: "Gareth Stockman", email: "gareth.stockman@marinepowersystems.co.uk", emails: ["gareth@marinepowersystems.co.uk"], role: "ned", firm: "Marine Power Systems", mandate: "NED — Marine Power Systems" },
  { name: "Miha Pavlovič", email: "miha.pavlovic@project-a.vc", role: "investor", firm: "Project A" },
];

export const SEEDED_ALIASES: FirmAlias[] = [
  { dirty: "13 Project A Ventures", clean: "Project A" },
  { dirty: "Project A Ventures", clean: "Project A" },
  { dirty: "14 Vsquared Ventures", clean: "Vsquared Ventures" },
  { dirty: "12 Playground Global", clean: "Playground Global" },
  { dirty: "3 HV Capital *", clean: "HV Capital" },
  { dirty: "11 Metaplanet", clean: "Metaplanet" },
];

export const DNC_FIRMS = ["Gresham House"];
export const DNC_PEOPLE = ["Sean Kingsbury", "Max Leeb"];

function dataPath(name: string): string {
  return join(process.cwd(), "data", name);
}

function readJson<T>(name: string, fallback: T): T {
  const file = dataPath(name);
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function loadRegistry(): RegistryPerson[] {
  const extra = readJson<RegistryPerson[]>("people-registry.json", []);
  const byKey = new Map<string, RegistryPerson>();
  for (const p of [...SEEDED_REGISTRY, ...extra]) {
    const key = (p.email ?? p.name).toLowerCase();
    byKey.set(key, { ...byKey.get(key), ...p });
  }
  return [...byKey.values()];
}

export function loadAliases(): FirmAlias[] {
  const extra = readJson<FirmAlias[]>("firm-aliases.json", []);
  return [...SEEDED_ALIASES, ...extra];
}

export function saveAlias(alias: FirmAlias) {
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  const extra = readJson<FirmAlias[]>("firm-aliases.json", []);
  extra.push(alias);
  writeFileSync(dataPath("firm-aliases.json"), JSON.stringify(extra, null, 2));
}

export function normalizeFirmName(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.trim();
  s = s.replace(/^\d+\s+/, "");
  s = s.replace(/\s+\*$/, "");
  s = s.replace(/^#+/, "");
  const aliases = loadAliases();
  const hit = aliases.find(
    (a) => a.dirty.toLowerCase() === s.toLowerCase() || a.dirty.toLowerCase() === raw.trim().toLowerCase(),
  );
  return hit?.clean ?? s;
}

export function isGenericInbox(email: string | null | undefined): boolean {
  if (!email || !email.includes("@")) return false;
  const local = email.split("@")[0] ?? "";
  return GENERIC_LOCAL.test(local);
}

export function lookupRegistry(query: {
  name?: string | null;
  email?: string | null;
}): RegistryPerson | null {
  const people = loadRegistry();
  const email = (query.email ?? "").toLowerCase();
  const name = (query.name ?? "").toLowerCase();
  if (email) {
    const byEmail = people.find(
      (p) =>
        p.email?.toLowerCase() === email ||
        p.emails?.some((e) => e.toLowerCase() === email),
    );
    if (byEmail) return byEmail;
  }
  if (name) {
    const byName = people.find(
      (p) =>
        p.name.toLowerCase() === name ||
        name.includes(p.name.toLowerCase()) ||
        p.name.toLowerCase().includes(name.split(/\s+/)[0] ?? "___"),
    );
    if (byName && name.length > 3) return byName;
  }
  return null;
}

export function roleLabel(role: PersonRole): string {
  if (role === "principal") return "Principal";
  if (role === "adviser") return "Adviser";
  if (role === "ned") return "NED conversation";
  if (role === "service") return "Service";
  if (role === "personal") return "Personal";
  return "Investor";
}

export function isDnc(name?: string | null, firm?: string | null): string | null {
  if (name && DNC_PEOPLE.some((n) => name.toLowerCase().includes(n.toLowerCase()))) {
    return `${name} is on the do-not-contact list`;
  }
  if (firm && DNC_FIRMS.some((n) => firm.toLowerCase().includes(n.toLowerCase()))) {
    return `${firm} is firm-wide do-not-contact`;
  }
  return null;
}
