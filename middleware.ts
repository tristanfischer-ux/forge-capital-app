import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Session-aware middleware. Two jobs:
 *
 *  1. Refresh the Supabase session cookie on every request (needed by SSR
 *     — see @supabase/ssr middleware guide). Without this, tokens expire
 *     mid-browse and server components lose the user.
 *
 *  2. Gate the authed surfaces. Any route under /(authed)/* resolves to
 *     paths the Next.js router doesn't expose — but the route group is
 *     transparent to URLs, so we gate by URL prefix instead. The tracker
 *     grid and draft preview both live under /tracker, so we gate there.
 *     Unauthenticated users bounce to / with ?next=<original path> so the
 *     magic-link callback can return them to where they were headed.
 *
 *  The / landing page + /auth/callback route stay public so sign-in works.
 */

const GATED_PREFIXES = ["/tracker", "/match"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

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
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: getUser() must be called to refresh the token.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isGated = GATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (isGated && !user) {
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Skip statics, Next internals, and favicons. Everything else runs through.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
