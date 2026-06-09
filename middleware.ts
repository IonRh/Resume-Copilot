// Copyright (c) 2025 wzdnzd
// SPDX-License-Identifier: MIT
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const AUTH_COOKIE = "site_auth";

export async function middleware(req: NextRequest) {
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

  if (/^[a-z0-9_-]{2,32}:[a-f0-9]{64}$/i.test(cookie)) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/auth";
  const from = `${pathname || "/"}${req.nextUrl.search || ""}`;
  url.searchParams.set("from", from);
  return NextResponse.redirect(url);
}

// Apply middleware to all paths except common static and API paths
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
};
