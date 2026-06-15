import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// Cookie name used for auth
const AUTH_COOKIE = "site_auth";

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(req: NextRequest) {
  const password = (process.env.SITE_PASSWORD ?? "").trim();

  // If no password configured, skip auth entirely
  if (!password) return NextResponse.next();

  const { pathname } = req.nextUrl;

  // Allow public assets and the auth endpoints
  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/")
  ) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(AUTH_COOKIE)?.value || "";
  const expected = await sha256(password);

  if (cookie === expected) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/auth";
  url.searchParams.set("from", pathname || "/");
  return NextResponse.redirect(url);
}

// Apply middleware to all paths except common static and API paths
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
};
