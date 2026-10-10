import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AUTH_COOKIE, authToken } from "@/server/auth-token";

const Body = z.object({ password: z.string().max(200) });

export async function POST(request: NextRequest) {
  const expected = process.env.DEMO_PASSWORD;
  if (!expected) return NextResponse.json({ ok: true });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.password !== expected) {
    return NextResponse.json({ error: "Nieprawidłowe hasło." }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, await authToken(expected), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 3600,
  });
  return response;
}
