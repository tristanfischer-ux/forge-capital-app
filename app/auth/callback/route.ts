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

  // Supabase can hand us an error directly as a query param (PKCE error path)
  // OR deliver it as a URL fragment (implicit/legacy error path). The fragment
  // case is handled client-side on the landing page; here we forward any
  // query-param error verbatim so the landing page shows something useful.
  const supabaseError = url.searchParams.get("error_description")
    ?? url.searchParams.get("error")
    ?? null;
  if (supabaseError) {
    return NextResponse.redirect(
      new URL(`/?auth_error=${encodeURIComponent(supabaseError)}`, request.url),
    );
  }

  if (!code) {
    // The most common reason we land here with no code AND no query error is
    // an expired magic link (Supabase redirects with the error in the URL
    // fragment, which the server can't see). The landing page reads the
    // fragment client-side; we nudge with a hint anyway.
    return NextResponse.redirect(
      new URL("/?auth_error=link_missing_code", request.url),
    );
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/?auth_error=${encodeURIComponent(error.message)}`, request.url),
    );
  }

  return NextResponse.redirect(new URL(next, request.url));
}
