import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isAllowedSignInEmail } from "@/lib/auth-allowlist";
import { getDevSession, isDevAuthBypassEnabled } from "@/lib/dev-auth";

/**
 * Session-aware proxy. Default-deny: anything not explicitly public
 * requires a session for tristan.fischer@gmail.com.
 *
 *  1. Refresh the Supabase session cookie on every request.
 *  2. Gate every non-public route. Unauthenticated users bounce to /
 *     with ?next=<original path>.
 *
 *  Public: landing page, magic-link callback, Gmail OAuth return,
 *  Vercel cron (secret-checked in the route), tracking pixels, PWA bits.
 *
 *  Production never honours fc_auth_bypass. DEV_SKIP_AUTH is inert
 *  when NODE_ENV === "production".
 */

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname.startsWith("/auth/callback")) return true;
  if (pathname.startsWith("/api/auth/gmail/callback")) return true;
  if (pathname.startsWith("/api/cron/")) return true;
  if (pathname.startsWith("/api/track/")) return true;
  if (pathname === "/manifest.webmanifest") return true;
  if (pathname === "/sw.js") return true;
  return false;
}

export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const pathname = request.nextUrl.pathname;
  const publicPath = isPublicPath(pathname);

  // Production: ignore the emergency bypass cookie. The /bypass routes
  // themselves now 404; this stops a leftover cookie from opening the desk.
  const bypassHonoured =
    process.env.NODE_ENV !== "production" &&
    request.cookies.get("fc_auth_bypass")?.value === "1";
  if (bypassHonoured && !publicPath) {
    return response;
  }

  let {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !publicPath && isDevAuthBypassEnabled()) {
    const session = await getDevSession();
    const { error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (!error) {
      user = session.user;
    }
  }

  if (user && !isAllowedSignInEmail(user.email)) {
    await supabase.auth.signOut();
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("auth_error", "not_allowed");
    return NextResponse.redirect(loginUrl);
  }

  if (!publicPath && !user) {
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
