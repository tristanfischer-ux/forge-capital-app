import { bumpSyncState } from "@/lib/capital/rpc";
import { createCoreClient } from "@/lib/supabase/capital";

export type EmailState = "verified" | "inferred" | "bounced" | "generic" | "unknown";

export type VerifyBadge =
  | "Verified"
  | "Catch-all"
  | "Invalid"
  | "Generic inbox"
  | "Unverified";

const GENERIC_LOCAL = new Set([
  "info",
  "contact",
  "hello",
  "team",
  "office",
  "ir",
  "enquiries",
  "inquiries",
  "admin",
  "support",
  "press",
  "media",
  "general",
  "partners",
  "fundraising",
  "deals",
  "invest",
  "investment",
  "bd",
  "business",
  "noreply",
  "no-reply",
  "donotreply",
]);

export function isGenericInbox(email: string | null | undefined): boolean {
  if (!email) return false;
  const local = email.trim().toLowerCase().split("@")[0] ?? "";
  const base = local.split("+")[0];
  return GENERIC_LOCAL.has(base);
}

export function badgeForEmailState(state: string | null | undefined): VerifyBadge {
  switch (state) {
    case "verified":
      return "Verified";
    case "inferred":
      return "Catch-all";
    case "bounced":
      return "Invalid";
    case "generic":
      return "Generic inbox";
    default:
      return "Unverified";
  }
}

export function badgeClassForEmailState(state: string | null | undefined): string {
  switch (state) {
    case "verified":
      return "badge b-ok";
    case "inferred":
      return "badge b-pending";
    case "bounced":
    case "generic":
      return "badge b-dead";
    default:
      return "badge b-pending";
  }
}

export function mapNeverBounceResult(result: string): EmailState {
  switch (result) {
    case "valid":
      return "verified";
    case "catchall":
      return "inferred";
    case "invalid":
    case "disposable":
      return "bounced";
    default:
      return "unknown";
  }
}

export type NeverBounceCheck = {
  email: string;
  email_state: EmailState;
  result: string;
  flags: string[];
  raw_status: string;
};

export async function checkNeverBounce(email: string): Promise<NeverBounceCheck> {
  const normalised = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {
    return {
      email: normalised,
      email_state: "unknown",
      result: "invalid_format",
      flags: [],
      raw_status: "invalid_format",
    };
  }
  if (isGenericInbox(normalised)) {
    return {
      email: normalised,
      email_state: "generic",
      result: "generic",
      flags: ["generic_inbox"],
      raw_status: "skipped",
    };
  }
  const key = process.env.NEVERBOUNCE_API_KEY?.trim();
  if (!key) {
    throw new Error("NEVERBOUNCE_API_KEY is not set");
  }
  const url = new URL("https://api.neverbounce.com/v4/single/check");
  url.searchParams.set("key", key);
  url.searchParams.set("email", normalised);
  const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new Error(`NeverBounce HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    status?: string;
    result?: string;
    flags?: string[];
    message?: string;
  };
  if (body.status !== "success") {
    throw new Error(`NeverBounce ${body.status ?? "error"}: ${body.message ?? ""}`.trim());
  }
  const result = body.result ?? "unknown";
  return {
    email: normalised,
    email_state: mapNeverBounceResult(result),
    result,
    flags: Array.isArray(body.flags) ? body.flags : [],
    raw_status: body.status ?? "success",
  };
}

export async function verifyPersonEmail(personId: string): Promise<{
  ok: boolean;
  email_state: EmailState;
  badge: VerifyBadge;
  error?: string;
}> {
  const core = createCoreClient();
  const { data: person, error } = await core
    .from("people")
    .select("id, email, email_state, dnc")
    .eq("id", personId)
    .maybeSingle();
  if (error || !person) {
    return { ok: false, email_state: "unknown", badge: "Unverified", error: "Person not on the book." };
  }
  if (!person.email) {
    return { ok: false, email_state: "unknown", badge: "Unverified", error: "No email on this person." };
  }
  if (isGenericInbox(person.email)) {
    await core
      .from("people")
      .update({ email_state: "generic", email_verified_at: new Date().toISOString() })
      .eq("id", personId);
    await bumpSyncState("neverbounce");
    return { ok: true, email_state: "generic", badge: "Generic inbox" };
  }
  try {
    const checked = await checkNeverBounce(person.email);
    await core
      .from("people")
      .update({
        email_state: checked.email_state,
        email_verified_at: new Date().toISOString(),
      })
      .eq("id", personId);
    await bumpSyncState("neverbounce");
    return {
      ok: true,
      email_state: checked.email_state,
      badge: badgeForEmailState(checked.email_state),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await bumpSyncState("neverbounce", message);
    return { ok: false, email_state: "unknown", badge: "Unverified", error: message };
  }
}
