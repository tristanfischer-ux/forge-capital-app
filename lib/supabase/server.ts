import {
  createServerClient as createSupabaseServerClient,
  type CookieOptions,
} from "@supabase/ssr";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Server-side Supabase client. Use inside server components, route handlers,
 * and server actions. Reads/writes the session cookie so RLS sees the user.
 *
 * When the `fc_auth_bypass` cookie is present (emergency GoTrue outage),
 * uses the admin client (service role key) which bypasses RLS entirely.
 */
export async function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in environment.",
    );
  }
  const cookieStore = await cookies();

  // Emergency bypass: if fc_auth_bypass cookie is set, use admin client
  // (service role key bypasses RLS, no valid session needed)
  const bypass = cookieStore.get("fc_auth_bypass");
  if (bypass?.value === "1") {
    return createAdminClient();
  }

  return createSupabaseServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll can throw when invoked from a server component (read-only cookies).
          // Middleware or route handlers will refresh the session in that case.
        }
      },
    },
  });
}
