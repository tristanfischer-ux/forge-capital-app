export const MANDATE_CODES = ["SS", "SK", "FF", "PA", "OD", "CA", "US", "HO", "YU"] as const;
export type MandateCode = (typeof MANDATE_CODES)[number];
export type MandateKind = "raise" | "customer";

export const MANDATE_LABEL: Record<MandateCode, string> = {
  SS: "Space Solar",
  SK: "SkySails",
  FF: "FishFrom",
  PA: "Panatere",
  OD: "Odysseus",
  CA: "Casper",
  US: "US Arbitrage",
  HO: "Hooley RF",
  YU: "Yuri",
};

export const MANDATE_KIND: Record<MandateCode, MandateKind> = {
  SS: "raise",
  SK: "raise",
  FF: "raise",
  PA: "raise",
  OD: "raise",
  CA: "raise",
  US: "raise",
  HO: "raise",
  YU: "customer",
};

export const MANDATE_OPTIONS = MANDATE_CODES.map((code) => ({
  code,
  label: MANDATE_LABEL[code],
  kind: MANDATE_KIND[code],
}));

/** Yuri team — always cc'd on RPM customer outreach. */
export const YU_CC = [
  "maria.birlem@yurigravity.com",
  "christian.bruderrek@yurigravity.com",
  "daniel.kaschubek@yurigravity.com",
];

export function mandateDraftCc(code: MandateCode): string[] | undefined {
  return code === "YU" ? YU_CC : undefined;
}

export function isCustomerMandate(code: MandateCode): boolean {
  return MANDATE_KIND[code] === "customer";
}

/** Phrases that identify a mandate in Gmail subjects. Used to reply in the right thread. */
export const MANDATE_SUBJECT_HINTS: Record<MandateCode, string[]> = {
  SS: ["Space Solar"],
  SK: ["SkySails", "Sky Sails"],
  FF: ["FishFrom", "Fish From"],
  PA: ["Panatere"],
  OD: ["Odysseus"],
  CA: ["Casper"],
  US: ["US Arbitrage"],
  HO: ["PHANTM", "Hooley"],
  YU: ["Yuri", "RPM"],
};

/** SkySails broad outreach is suspended; Hooley is paused; Yuri is not a raise. */
export function isChaseDraftable(code: MandateCode): boolean {
  if (code === "HO" || code === "SK") return false;
  if (isCustomerMandate(code)) return false;
  return true;
}

export function mandateGmailQuery(code: MandateCode, email: string): string {
  const hints = MANDATE_SUBJECT_HINTS[code]
    .map((h) => `"${h.replace(/"/g, "")}"`)
    .join(" OR ");
  return `in:sent to:"${email.trim().toLowerCase()}" subject:(${hints})`;
}

export const CALENDLY_URL = "https://calendly.com/tristan-fischer-wjlf/30min";
export const TRISTAN_MOBILE = "+44 7776191944";
export const TRISTAN_EMAIL = "tristan.fischer@gmail.com";
export const TRISTAN_LINKEDIN = "https://www.linkedin.com/in/tristanfischer/";
export const TRISTAN_THOUGHTS = "www.historyfuturenow.com";
export const COLLISION_DAYS = 21;
