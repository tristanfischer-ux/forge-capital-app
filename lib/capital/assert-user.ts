import { isAllowedSignInEmail } from "@/lib/auth-allowlist";
import { createServerClient } from "@/lib/supabase/server";

export async function requireTristan(): Promise<{ id: string; email: string }> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email ?? "";
  if (!user || !isAllowedSignInEmail(email)) {
    throw new Error("Not signed in.");
  }
  return { id: user.id, email };
}
