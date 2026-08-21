const NOISE_LOCAL = new Set([
  "noreply",
  "no-reply",
  "donotreply",
  "mailer-daemon",
  "postmaster",
  "notifications",
  "newsletter",
  "news",
  "updates",
  "digest",
  "marketing",
  "bounce",
  "bounces",
]);

const NOISE_DOMAINS = [
  "linkedin.com",
  "facebookmail.com",
  "mailchimp.com",
  "substack.com",
  "google.com",
  "calendly.com",
  "github.com",
  "twitter.com",
  "x.com",
  "sendgrid.net",
  "amazonses.com",
  "intercom.io",
  "notion.so",
  "slack.com",
];

export function normalizeEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  const local = e.slice(0, at).split("+")[0];
  const domain = e.slice(at + 1);
  return `${local}@${domain}`;
}

export function isNoiseAddress(email: string): boolean {
  const n = normalizeEmail(email);
  const [local, domain] = n.split("@");
  if (!domain) return true;
  if (NOISE_LOCAL.has(local)) return true;
  return NOISE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function extractDisplayNames(blob: string): string[] {
  const names: string[] = [];
  const quoted = blob.matchAll(/"([^"]{3,80})"/g);
  for (const m of quoted) names.push(m[1]);
  const angled = blob.matchAll(/([^<@,]{3,80})\s*</g);
  for (const m of angled) names.push(m[1]);
  return names
    .map((n) => n.replace(/\s+/g, " ").trim())
    .filter((n) => n && !n.includes("@") && !/^the /i.test(n));
}
