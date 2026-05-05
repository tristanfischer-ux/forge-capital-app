import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";

/**
 * Emergency production auth bypass — GoTrue is completely down.
 * Generates a valid Supabase session JWT and sets it as a cookie,
 * bypassing GoTrue entirely.
 *
 * The JWT is signed with the same Supabase project secret that the
 * anon key uses, so downstream `getUser()` calls work.
 *
 * Usage: visit /api/auth/bypass?token=<BYPASS_SECRET>
 *
 * TODO: Remove once GoTrue recovers.
 */

const BYPASS_SECRET = process.env.SUPABASE_AUTH_BYPASS_SECRET;
const TRISTAN_USER_ID = "815369eb-84e2-42e6-b729-241f264b180b";
const TRISTAN_EMAIL = "tristan.fischer@gmail.com";
const PROJECT_REF = "kgkajatjyqfetdtbzmwg";

export async function GET(request: Request) {
  if (!BYPASS_SECRET) {
    return NextResponse.json({ error: "Bypass not configured" }, { status: 500 });
  }

  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken !== BYPASS_SECRET) {
    return NextResponse.json({ error: "Invalid bypass token" }, { status: 403 });
  }

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    return NextResponse.json({ error: "Missing anon key" }, { status: 500 });
  }

  // The anon key is base64url-encoded. Decode it to get the JWT signing secret.
  let jwtSecret: string;
  try {
    const padded = anonKey.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (padded.length % 4)) % 4);
    const decoded = Buffer.from(padded + padding, "base64").toString("utf-8");
    const parts = JSON.parse(decoded);
    jwtSecret = parts[0]; // First element is the JWT secret
  } catch {
    return NextResponse.json({ error: "Failed to decode anon key" }, { status: 500 });
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 3600;

  const payload = {
    aud: "authenticated",
    exp: expiresAt,
    iat: now,
    iss: `https://${PROJECT_REF}.supabase.co/auth/v1`,
    sub: TRISTAN_USER_ID,
    email: TRISTAN_EMAIL,
    role: "authenticated",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
  };

  // Sign with HS256 (same as Supabase)
  const sessionToken = jwt.sign(payload, jwtSecret, { algorithm: "HS256" });

  // Build the session object that Supabase SSR expects
  const session = {
    access_token: sessionToken,
    refresh_token: "bypass-no-refresh",
    expires_in: 3600,
    expires_at: expiresAt,
    token_type: "bearer",
    user: {
      id: TRISTAN_USER_ID,
      email: TRISTAN_EMAIL,
      role: "authenticated",
      aud: "authenticated",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      created_at: new Date("2026-04-21T16:05:00Z").toISOString(),
      confirmed_at: new Date("2026-04-21T16:05:00Z").toISOString(),
    },
  };

  // The session cookie stores a JSON array: [access_token, refresh_token, provider_token, provider_refresh_token]
  const cookieValue = JSON.stringify([sessionToken, "bypass-no-refresh", null, null]);
  const cookieName = `sb-${PROJECT_REF}-auth-token`;

  const response = NextResponse.redirect(new URL("/discover", request.url));
  response.cookies.set(cookieName, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 3600,
  });

  return response;
}
