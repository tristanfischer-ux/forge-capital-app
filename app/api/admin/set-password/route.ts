import { NextResponse } from "next/server";

/**
 * TEMPORARY — retries GoTrue admin API with multiple attempts.
 * GoTrue has been intermittently failing; this retries with delays.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { email, password } = body as { email?: string; password?: string };
  if (!email || !password) return NextResponse.json({ error: "email and password required" }, { status: 400 });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  const headers = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };

  // Retry up to 5 times with exponential backoff
  let lastError = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 3000));

    try {
      // Try listing users to find the user ID
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);

      const listRes = await fetch("https://kgkajatjyqfetdtbzmwg.supabase.co/auth/v1/admin/users", {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!listRes.ok) {
        lastError = `list-users status ${listRes.status}: ${await listRes.text()}`;
        continue;
      }

      const { users } = (await listRes.json()) as { users: Array<{ id: string; email: string }> };
      const user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (!user) return NextResponse.json({ error: `User not found: ${email}` }, { status: 404 });

      // Set password
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), 15000);

      const updateRes = await fetch(
        `https://kgkajatjyqfetdtbzmwg.supabase.co/auth/v1/admin/users/${user.id}`,
        {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ password, email_confirm: true }),
          signal: controller2.signal,
        },
      );
      clearTimeout(timer2);

      if (!updateRes.ok) {
        lastError = `set-password status ${updateRes.status}: ${await updateRes.text()}`;
        continue;
      }

      return NextResponse.json({ ok: true, userId: user.id, attempts: attempt + 1 });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return NextResponse.json({ error: "All attempts failed", detail: lastError }, { status: 502 });
}
