/**
 * Column map for `260817 Master Investor Tracker TF (CANONICAL).xlsx`
 * Master Tracker sheet. Opened and counted 21 Aug 2026:
 * 2 header rows, 2,844 data rows, investor name in column 10 (index 9),
 * 2,835 unique names, 0 blank names. Last-contact "Days ago" is column 1.
 */
export const MASTER_HEADER_ROWS = 2;

export const MASTER_COL = {
  daysAgo: 0,
  tickSkySails: 1,
  tickFishFrom: 2,
  tickPanatere: 3,
  tickSpaceSolar: 4,
  tickCasper: 5,
  tickUsArb: 6,
  tickOdysseus: 7,
  tickHooley: 8,
  investor: 9,
  website: 10,
  contact: 11,
  email: 12,
  sector: 13,
  nCompanies: 14,
} as const;

export const MANDATE_BLOCKS: {
  code: "SK" | "FF" | "PA" | "SS" | "CA" | "US" | "OD" | "HO";
  header: string;
  firstSent: number;
  latest: number;
  daysSince: number;
  status: number;
  commentary: number;
}[] = [
  { code: "SK", header: "SKYSAILS POWER", firstSent: 15, latest: 16, daysSince: 17, status: 18, commentary: 19 },
  { code: "FF", header: "FISHFROM", firstSent: 20, latest: 21, daysSince: 22, status: 23, commentary: 24 },
  { code: "PA", header: "PANATERE", firstSent: 25, latest: 26, daysSince: 27, status: 28, commentary: 29 },
  { code: "SS", header: "SPACE SOLAR", firstSent: 30, latest: 31, daysSince: 32, status: 33, commentary: 34 },
  { code: "CA", header: "CASPER FUNDING", firstSent: 35, latest: 36, daysSince: 37, status: 38, commentary: 39 },
  { code: "US", header: "US ARBITRAGE", firstSent: 40, latest: 41, daysSince: 42, status: 43, commentary: 44 },
  { code: "OD", header: "ODYSSEUS SPACE", firstSent: 45, latest: 46, daysSince: 47, status: 48, commentary: 49 },
  { code: "HO", header: "HOOLEY RF", firstSent: 50, latest: 51, daysSince: 52, status: 53, commentary: 54 },
];

export const JORDAN_META = {
  source: 55,
  onJordanList: 56,
  jordanRowHidden: 57,
  jordanStatut: 58,
  odysseusOutreachRule: 59,
  ruleNote: 60,
  jordanEmail: 61,
  jordanNotes: 62,
} as const;

export const CANONICAL_XLSX =
  "/Users/tristanfischer/Developer/Forge-Capital/260817 Master Investor Tracker TF (CANONICAL).xlsx";

export const EXPECTED_MASTER_DATA_ROWS = 2844;
export const EXPECTED_MASTER_SHEET_ROWS = 2846;
