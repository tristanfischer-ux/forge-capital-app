/**
 * DEV-ONLY auth bypass helper.
 *
 * Gated by TWO conditions that MUST both be true before any logic here runs:
 *
 *   1. `process.env.NODE_ENV !== "production"`
 *   2. `process.env.DEV_SKIP_AUTH === "1"`
 *
 * Either condition alone disables the bypass. In production the whole
 * module is effectively inert — `isDevAuthBypassEnabled()` returns false
 * and nothing else in here is callable without it.
 *
 * Purpose: sub-agents doing parity screenshots against the authed surfaces
 * (/home, /tracker, /match, …) can set DEV_SKIP_AUTH=1 in `.env.local`,
 * run `npm run dev`, and the middleware will mint a real Supabase session
 * for `tristan.fischer@gmail.com` and write the session cookies on the
 * response. Pages behave as if that user signed in via magic link, so
 * server components see `supabase.auth.getUser()` returning the user
 * and RLS reads succeed.
 *
 * Flow:
 *   1. Admin API (`supabase.auth.admin.generateLink({type:'magiclink'})`)
 *      creates/returns the target user + a one-shot `hashed_token`.
 *   2. We call `supabase.auth.verifyOtp({type:'magiclink', token_hash})`
 *      on a throwaway client to exchange the hash for an access_token +
 *      refresh_token. The resulting `Session` is cached in-memory.
 *   3. The middleware calls `getDevSession()`, then `setSession(...)` on
 *      the real request-scoped client — which fires SIGNED_IN and writes
 *      the `sb-<ref>-auth-token` cookie via the standard @supabase/ssr
 *      adapter. After that, every downstream server component sees a
 *      normal authed session.
 *
 * Cache: one session per process, invalidated 5 minutes before expiry.
 * Concurrent middleware invocations share the same in-flight promise so
 * we don't hammer the admin API.
 *
 * Hard rules:
 *   - Never import this from anywhere other than middleware.ts (or a dev
 *     tool that's explicitly gated by the same env check).
 *   - Never log or return the session body to the user.
 *   - Never activate in production — NODE_ENV check is the primary guard.
 */

import { createClient, type Session } from "@supabase/supabase-js";

const DEV_TEST_EMAIL = "tristan.fischer@gmail.com";

// Refresh 5 minutes before token expiry — Supabase access tokens default
// to 3600s, so this leaves plenty of headroom but avoids cache misses on
// every request.
const EXPIRY_SAFETY_WINDOW_SECONDS = 5 * 60;

let cachedSession: Session | null = null;
let inFlight: Promise<Session> | null = null;

export function isDevAuthBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_SKIP_AUTH === "1"
  );
}

function isStillValid(session: Session | null): session is Session {
  if (!session || !session.expires_at) return false;
  const now = Math.floor(Date.now() / 1000);
  return session.expires_at - EXPIRY_SAFETY_WINDOW_SECONDS > now;
}

/**
 * Mint a fresh session for the dev test user via admin magic-link →
 * verifyOtp. Returns the full Session (access_token + refresh_token +
 * user) — same shape the auth-js client hands back after a real sign-in.
 */
async function mintDevSession(): Promise<Session> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !serviceRoleKey || !anonKey) {
    throw new Error(
      "[dev-auth] Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  // Admin client — service role, no session persistence (we're the
  // short-lived issuer, not a logged-in user).
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: DEV_TEST_EMAIL,
  });
  if (linkError) {
    throw new Error(
      `[dev-auth] admin.generateLink failed: ${linkError.message} (status ${linkError.status ?? "?"})`,
    );
  }
  const hashedToken = linkData?.properties?.hashed_token;
  if (!hashedToken) {
    throw new Error("[dev-auth] admin.generateLink returned no hashed_token");
  }

  // Verifier client — anon key, no cookie/localStorage, pure network call.
  // Trades the hashed token for a real session we can set on the request
  // client in the middleware.
  const verifier = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verifyData, error: verifyError } = await verifier.auth.verifyOtp({
    type: "magiclink",
    token_hash: hashedToken,
  });
  if (verifyError) {
    throw new Error(
      `[dev-auth] verifyOtp failed: ${verifyError.message} (status ${verifyError.status ?? "?"})`,
    );
  }
  if (!verifyData.session) {
    throw new Error("[dev-auth] verifyOtp returned no session");
  }
  return verifyData.session;
}

/**
 * Return a valid cached session, minting + caching a new one if the
 * current cache is missing or near expiry. Concurrent callers share a
 * single in-flight request so we don't mint N sessions per request burst.
 *
 * Safe to call unconditionally — if the bypass isn't enabled, callers
 * shouldn't reach this (the middleware checks `isDevAuthBypassEnabled`
 * first). If they do, this still works — it just costs a round-trip to
 * the admin API.
 */
export async function getDevSession(): Promise<Session> {
  if (isStillValid(cachedSession)) return cachedSession;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const session = await mintDevSession();
      cachedSession = session;
      return session;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
