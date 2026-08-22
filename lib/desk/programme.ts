import { MANDATE_CODES, type MandateCode } from "@/lib/capital/mandates";

export const PROGRAMME_COOKIE = "fc_programme";

export function parseProgramme(raw: string | null | undefined): MandateCode {
  const code = (raw ?? "").trim().toUpperCase();
  return (MANDATE_CODES as readonly string[]).includes(code)
    ? (code as MandateCode)
    : "SS";
}

export function isMandatePathCode(raw: string): boolean {
  return (MANDATE_CODES as readonly string[]).includes(raw.toUpperCase());
}
