import { NextResponse } from "next/server";

/**
 * Emergency production auth bypass — GoTrue is completely down.
 * 
 * 1. Visit /api/auth/bypass?token=<BYPASS_SECRET>
 *    → Sets a bypass cookie and redirects to /discover
 * 2. The middleware checks this cookie and skips the auth gate
 * 3. Server components use createAdminClient() when bypass cookie is present
 *
 * TODO: Remove once GoTrue recovers.
 */

const BYPASS_SECRET = process.env.SUPABASE_AUTH_BYPASS_SECRET;
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

  // Set a bypass cookie — the middleware checks this to skip the auth gate
  // Secure flag must be false on localhost (HTTP) — only true on production (HTTPS)
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const response = NextResponse.redirect(new URL("/discover", request.url));
  response.cookies.set("fc_auth_bypass", "1", {
    httpOnly: true,
    secure: !isLocalhost,
    sameSite: "lax",
    path: "/",
    maxAge: 3600,
  });

  return response;
}
