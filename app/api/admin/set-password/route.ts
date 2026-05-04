import { NextResponse } from "next/server";

/**
 * TEMPORARY — admin endpoint to set a user's password via the service role key.
 * Uses Vercel's network to reach GoTrue (our local machine is blocked by Cloudflare).
 * Should be removed after password is set.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { email, password } = body as { email?: string; password?: string };

  if (!email || !password) {
    return NextResponse.json(
      { error: "email and password required" },
      { status: 400 },
    );
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 },
    );
  }

  // List users to find the user ID by email
  const listRes = await fetch(
    "https://kgkajatjyqfetdtbzmwg.supabase.co/auth/v1/admin/users",
    {
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
    },
  );

  if (!listRes.ok) {
    const text = await listRes.text();
    return NextResponse.json(
      { error: "Failed to list users", detail: text },
      { status: 502 },
    );
  }

  const { users } = (await listRes.json()) as {
    users: Array<{ id: string; email: string }>;
  };

  const user = users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );

  if (!user) {
    return NextResponse.json(
      { error: `User not found: ${email}` },
      { status: 404 },
    );
  }

  // Set the password using admin API
  const updateRes = await fetch(
    `https://kgkajatjyqfetdtbzmwg.supabase.co/auth/v1/admin/users/${user.id}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        password,
        email_confirm: true,
      }),
    },
  );

  if (!updateRes.ok) {
    const text = await updateRes.text();
    return NextResponse.json(
      { error: "Failed to set password", detail: text },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, userId: user.id });
}
