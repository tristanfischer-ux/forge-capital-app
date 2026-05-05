import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();
  const { email, password } = body as { email?: string; password?: string };
  if (!email || !password) return NextResponse.json({ error: "email and password required" }, { status: 400 });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  // List users
  const listRes = await fetch("https://kgkajatjyqfetdtbzmwg.supabase.co/auth/v1/admin/users", {
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
  });
  if (!listRes.ok) return NextResponse.json({ error: "Failed to list users", detail: await listRes.text() }, { status: 502 });

  const { users } = await listRes.json() as { users: Array<{ id: string; email: string }> };
  const user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) return NextResponse.json({ error: `User not found: ${email}` }, { status: 404 });

  // Set password
  const updateRes = await fetch(`https://kgkajatjyqfetdtbzmwg.supabase.co/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ password, email_confirm: true }),
  });
  if (!updateRes.ok) return NextResponse.json({ error: "Failed to set password", detail: await updateRes.text() }, { status: 502 });

  return NextResponse.json({ ok: true, userId: user.id });
}
