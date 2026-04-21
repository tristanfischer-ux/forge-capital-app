import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { exchangeCodeForTokens } from "@/lib/gmail/oauth";

/**
 * Gmail OAuth callback. Verifies `state`, exchanges `code` for a token pair,
 * stores the refresh_token in `gmail_tokens` keyed to the signed-in Supabase
 * user, then redirects to the tracker so they can use the draft button.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/home?gmail_connect_error=${encodeURIComponent(error)}`, request.url),
    );
  }
  if (!code || !state) {
    return NextResponse.redirect(
      new URL(`/home?gmail_connect_error=missing_params`, request.url),
    );
  }

  const expectedState = request.cookies.get("gmail_oauth_state")?.value;
  if (!expectedState || expectedState !== state) {
    return NextResponse.redirect(
      new URL(`/home?gmail_connect_error=state_mismatch`, request.url),
    );
  }

  const supabase = await createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.redirect(
      new URL(`/?next=/api/auth/gmail/callback`, request.url),
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Google only returns refresh_token on first consent; if the user
      // previously granted and we asked for consent again, we should still
      // get one because we set prompt=consent.
      throw new Error(
        "No refresh_token returned — Google may have used a cached grant. Revoke access at https://myaccount.google.com/permissions and try again.",
      );
    }

    const nowMs = Date.now();
    const expiresAt = new Date(nowMs + tokens.expires_in * 1000).toISOString();

    const { error: upsertError } = await supabase
      .from("gmail_tokens")
      .upsert(
        {
          user_id: auth.user.id,
          email: auth.user.email ?? "",
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: expiresAt,
          scope: tokens.scope,
          token_type: tokens.token_type,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (upsertError) throw new Error(`gmail_tokens upsert: ${upsertError.message}`);

    const response = NextResponse.redirect(new URL("/home?gmail_connected=1", request.url));
    response.cookies.delete("gmail_oauth_state");
    return response;
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Gmail OAuth callback error";
    return NextResponse.redirect(
      new URL(`/home?gmail_connect_error=${encodeURIComponent(msg)}`, request.url),
    );
  }
}
