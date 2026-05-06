import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET() {
  const response = NextResponse.redirect(new URL("/investors", "http://localhost:3000"));
  response.cookies.set("fc_auth_bypass", "1", { path: "/", maxAge: 86400 });
  return response;
}
