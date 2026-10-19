/** Strip the Apex / ForgeOS do-not-contact label before comparing names. */
const DNC_PREFIX = /^(?:⛔\s*)?DO NOT CONTACT\s*[—–-]\s*/i;

export const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function stripDncPrefix(name: string): string {
  return name.replace(/^⛔\s*/, "").replace(DNC_PREFIX, "").trim();
}

export function isDncFirmName(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.startsWith("⛔")) return true;
  return /do not contact/i.test(trimmed.slice(0, 40));
}

/** Matches ForgeOS `core.firms.norm_name` / `core.firm_aliases.norm_alias`. */
export function normFirmName(name: string | null | undefined): string {
  if (!name) return "";
  return stripDncPrefix(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function websiteDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  const raw = website.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    return host || null;
  } catch {
    const host = raw
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .replace(/^www\./i, "")
      .toLowerCase();
    return host || null;
  }
}

const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "live.com",
  "msn.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "btinternet.com",
  "mac.com",
]);

export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const m = email.trim().toLowerCase().match(/@([^>\s,;]+)/);
  if (!m) return null;
  const d = m[1].replace(/^www\./, "");
  if (!d || GENERIC_EMAIL_DOMAINS.has(d)) return null;
  return d;
}

export function statusRank(code: string | null | undefined): number {
  if (!code) return Number.NEGATIVE_INFINITY;
  if (code === "+6.5") return 6.5;
  const n = Number(code);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

export function gmailSourceKeys(id: string | null | undefined): string[] {
  if (!id) return [];
  const raw = id.trim();
  if (!raw) return [];
  const bare = raw.startsWith("gmail:") ? raw.slice("gmail:".length) : raw;
  return [...new Set([bare, `gmail:${bare}`])];
}
