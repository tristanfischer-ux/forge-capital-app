import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { createServerClient } from "@/lib/supabase/server";
import { buildAuthorizationUrl } from "@/lib/gmail/oauth";

/**
 * Initiates the Gmail OAuth flow. Generates a random state, stores it in a
 * short-lived HTTP-only cookie, redirects to Google's consent screen.
 * The callback route (`/api/auth/gmail/callback`) verifies the state +
 * exchanges the code for tokens.
 *
 * Requires the user to be signed in — otherwise bounces to /.
 */
export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.redirect(new URL("/?next=/api/auth/gmail", request.url));
  }

  try {
    const state = randomBytes(24).toString("hex");
    const response = NextResponse.redirect(buildAuthorizationUrl(state));
    response.cookies.set("gmail_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600, // 10 minutes to complete the OAuth handshake
    });
    return response;
  } catch (err) {
    return NextResponse.redirect(
      new URL(
        `/?auth_error=${encodeURIComponent(
          err instanceof Error
            ? err.message
            : "Gmail OAuth not yet configured — check env vars",
        )}`,
        request.url,
      ),
    );
  }
}
