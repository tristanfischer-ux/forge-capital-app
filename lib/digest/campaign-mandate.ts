import { MANDATE_SUBJECT_HINTS, type MandateCode } from "@/lib/capital/mandates";

/**
 * Apex campaign name / display_name → ForgeOS mandate code.
 * Exact normalised names only — "SkySails Islanded AI" must not become SK
 * (SkySails Power).
 */
const NAME_TO_CODE: Record<string, string> = {
  "skysails power": "SK",
  "panatere": "PA",
  "fishfrom technologies": "FF",
  "fishfrom": "FF",
  "casper funding": "CA",
  "casper": "CA",
  "us arbitrage": "US",
  "hooley rf": "HO",
  "hooley rf / phantm": "HO",
  "space solar": "SS",
  "odysseus space": "OD",
  "odysseus": "OD",
  "space federation": "ES",
  "europa space group": "ES",
  "yuri": "YU",
};

export type MandateHint = {
  id: string;
  code: string;
  company_name: string | null;
  hints: string[];
};

export function extraSubjectHints(code: string): string[] {
  const fromCanon =
    code in MANDATE_SUBJECT_HINTS
      ? [...MANDATE_SUBJECT_HINTS[code as MandateCode]]
      : [];
  if (code === "ES") return ["Europa Space Group", "Space Federation", ...fromCanon];
  if (code === "SK") return ["SkySails Power", ...fromCanon];
  if (code === "PA") return ["Panatere", ...fromCanon];
  return fromCanon;
}

export function mapCampaignToCode(
  name: string,
  displayName?: string | null,
): string | null {
  const candidates = [name, displayName ?? ""]
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const c of candidates) {
    if (NAME_TO_CODE[c]) return NAME_TO_CODE[c];
  }
  return null;
}

export function resolveCampaignMandate(
  campaign: { name: string; display_name?: string | null },
  mandates: { id: string; code: string; company_name: string | null }[],
): { mandate: MandateHint | null; unmappedReason: string | null } {
  const code =
    mapCampaignToCode(campaign.name, campaign.display_name) ??
    matchByCompanyName(campaign, mandates);
  if (!code) {
    return {
      mandate: null,
      unmappedReason: `no ForgeOS mandate for Apex campaign "${campaign.name}"`,
    };
  }
  const row = mandates.find((m) => m.code.toUpperCase() === code.toUpperCase());
  if (!row) {
    return {
      mandate: null,
      unmappedReason: `ForgeOS has no mandate row for code ${code} (Apex "${campaign.name}")`,
    };
  }
  const hints = [
    ...extraSubjectHints(row.code),
    row.company_name ?? "",
    campaign.name,
    campaign.display_name ?? "",
  ]
    .map((h) => h.trim())
    .filter(Boolean);
  return {
    mandate: {
      id: row.id,
      code: row.code,
      company_name: row.company_name,
      hints: [...new Set(hints)],
    },
    unmappedReason: null,
  };
}

function matchByCompanyName(
  campaign: { name: string; display_name?: string | null },
  mandates: { id: string; code: string; company_name: string | null }[],
): string | null {
  const names = [campaign.name, campaign.display_name ?? ""]
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const m of mandates) {
    const company = (m.company_name ?? "").trim().toLowerCase();
    if (company && names.includes(company)) return m.code;
  }
  return null;
}

export function subjectNamesOtherMandate(
  subject: string,
  thisHints: string[],
  otherMandates: MandateHint[],
): MandateHint | null {
  const hay = subject.toLowerCase();
  if (!hay.trim()) return null;
  const thisHit = thisHints.some((h) => h && hay.includes(h.toLowerCase()));
  if (thisHit) return null;
  for (const other of otherMandates) {
    if (other.hints.some((h) => h && hay.includes(h.toLowerCase()))) return other;
  }
  return null;
}
