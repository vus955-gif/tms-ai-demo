import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authToken } from "./server/auth-token";

/** Optional password gate for the whole demo, active only when DEMO_PASSWORD is set. */
export async function proxy(request: NextRequest) {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (token && token === (await authToken(password))) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "To demo jest chronione hasłem." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|cmr-samples/|maplibre/|.*\\.(?:png|svg|jpg|jpeg|webp|ico)$).*)"],
};
