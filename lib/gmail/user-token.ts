import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshAccessToken } from "./oauth";

export async function getGoogleAccessToken(): Promise<{
  accessToken: string;
  scope: string;
}> {
  const supabase = await createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("gmail_tokens")
    .select("access_token, refresh_token, expires_at, scope, user_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (error) throw new Error(`gmail_tokens read failed: ${error.message}`);
  if (!row) throw new Error("NOT_CONNECTED");
  const now = Date.now();
  const expires = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (row.access_token && expires > now + 60_000) {
    return { accessToken: row.access_token as string, scope: String(row.scope ?? "") };
  }
  const refreshed = await refreshAccessToken(row.refresh_token as string);
  const newExpires = new Date(now + refreshed.expires_in * 1000).toISOString();
  await admin
    .from("gmail_tokens")
    .update({
      access_token: refreshed.access_token,
      expires_at: newExpires,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", auth.user.id);
  return { accessToken: refreshed.access_token, scope: String(row.scope ?? "") };
}

export async function getGoogleAccessTokenAdmin(): Promise<{
  accessToken: string;
  scope: string;
} | null> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("gmail_tokens")
    .select("access_token, refresh_token, expires_at, scope, user_id")
    .limit(1)
    .maybeSingle();
  if (!row) return null;
  const now = Date.now();
  const expires = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (row.access_token && expires > now + 60_000) {
    return { accessToken: row.access_token as string, scope: String(row.scope ?? "") };
  }
  const refreshed = await refreshAccessToken(row.refresh_token as string);
  await admin
    .from("gmail_tokens")
    .update({
      access_token: refreshed.access_token,
      expires_at: new Date(now + refreshed.expires_in * 1000).toISOString(),
    })
    .eq("user_id", row.user_id);
  return { accessToken: refreshed.access_token, scope: String(row.scope ?? "") };
}
