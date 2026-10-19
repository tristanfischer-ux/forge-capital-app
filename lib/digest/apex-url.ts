/**
 * Local `.env.local` has in the past pointed NEXT_PUBLIC_SUPABASE_URL at
 * a different Supabase project than SUPABASE_SERVICE_ROLE_KEY. Prefer the
 * URL when it matches the JWT `ref`; otherwise use the JWT project host.
 * Never log the key.
 */
export function resolveApexUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const jwt = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!envUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  }
  if (!jwt || jwt.split(".").length < 2) return envUrl;
  try {
    const payload = JSON.parse(
      Buffer.from(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
        "utf8",
      ),
    ) as { ref?: string };
    if (payload.ref && !envUrl.includes(payload.ref)) {
      return `https://${payload.ref}.supabase.co`;
    }
  } catch {
    /* keep env URL */
  }
  return envUrl;
}
