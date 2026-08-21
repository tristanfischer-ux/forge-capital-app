export const MANDATE_CODES = ["SS", "SK", "FF", "PA", "OD", "CA", "US", "HO"] as const;
export type MandateCode = (typeof MANDATE_CODES)[number];

export const MANDATE_LABEL: Record<MandateCode, string> = {
  SS: "Space Solar",
  SK: "SkySails",
  FF: "FishFrom",
  PA: "Panatere",
  OD: "Odysseus",
  CA: "Casper",
  US: "US Arbitrage",
  HO: "Hooley RF",
};

export const MANDATE_OPTIONS = MANDATE_CODES.map((code) => ({
  code,
  label: MANDATE_LABEL[code],
}));

export const CALENDLY_URL = "https://calendly.com/tristan-fischer-wjlf/30min";
export const TRISTAN_MOBILE = "+44 7776191944";
export const TRISTAN_EMAIL = "tristan.fischer@gmail.com";
export const TRISTAN_LINKEDIN = "https://www.linkedin.com/in/tristanfischer/";
export const TRISTAN_THOUGHTS = "www.historyfuturenow.com";
export const COLLISION_DAYS = 21;
