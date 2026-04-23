/**
 * Gmail OAuth 2.0 helpers. Three-legged flow:
 *   1. /api/auth/gmail            — redirect user to Google consent
 *   2. /api/auth/gmail/callback   — receive ?code=, exchange for tokens, store
 *   3. Downstream createDraft uses the stored refresh_token to mint an
 *      access_token on demand.
 *
 * Env vars expected (set in Vercel + .env.local):
 *   GMAIL_CLIENT_ID        — OAuth 2.0 client ID from Google Cloud Console
 *   GMAIL_CLIENT_SECRET    — OAuth 2.0 client secret
 *   GMAIL_REDIRECT_URI     — e.g. https://forge-capital-app.vercel.app/api/auth/gmail/callback
 *
 * Scopes granted (Phase 8):
 *   - `gmail.compose`  — create drafts (Phase 4, existing).
 *   - `gmail.readonly` — list + fetch messages so the inbound sync daemon
 *                        (scripts/gmail-sync.ts) can find replies/bounces
 *                        from campaign_partners and upsert contact_events.
 *
 * `gmail.metadata` would be narrower but forbids the `q=` search parameter
 * we need to filter by from:/to:/after: — so readonly is the right call.
 *
 * `access_type=offline` + `prompt=consent` are mandatory: offline so we
 * get a refresh_token, consent-prompt so we re-get a refresh_token on
 * subsequent authorisations if the user has already granted before.
 *
 * Users who connected pre-Phase-8 have only `gmail.compose` — the inbound
 * daemon will log a "scope_insufficient" status for those rows and skip
 * them until the user reconnects via /api/auth/gmail.
 */

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly",
  // Added 2026-04-23 — CRM calendar ingest reads Tristan's primary
  // calendar and auto-logs meetings with partners as contact_events.
  // Read-only is sufficient; we never write back to Calendar.
  // Users who connected before this change need to /api/auth/gmail
  // reconnect to upgrade their scope; the ingest script skips rows
  // where scope is insufficient.
  "https://www.googleapis.com/auth/calendar.readonly",
];
export const GMAIL_SCOPE = GMAIL_SCOPES.join(" ");

export function buildAuthorizationUrl(state: string): string {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    throw new Error(
      "GMAIL_CLIENT_ID or GMAIL_REDIRECT_URI missing — configure in Vercel env after setting up OAuth in Google Cloud Console.",
    );
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

/** Exchange an authorisation code for a token pair. */
export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Gmail OAuth env vars missing");
  }
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Gmail token exchange failed: HTTP ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Mint a fresh access_token from a stored refresh_token. */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Gmail OAuth env vars missing");
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Gmail token refresh failed: HTTP ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  return json;
}
