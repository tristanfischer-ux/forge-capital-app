import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Magic-link callback. Supabase emails a URL like
 *   https://forge-capital-app.vercel.app/auth/callback?code=<opaque>&next=/tracker
 * This route exchanges the `code` for a session (sets the session cookie),
 * then redirects to `next` (default /tracker).
 *
 * If the exchange fails (expired link, tampered code), we bounce back to
 * the landing page with ?error=<msg> so the user can request a fresh link.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/tracker";

  if (!code) {
    return NextResponse.redirect(
      new URL("/?error=missing_code", request.url),
    );
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(error.message)}`, request.url),
    );
  }

  return NextResponse.redirect(new URL(next, request.url));
}
