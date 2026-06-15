import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

const AUTH_COOKIE = "site_auth";

function sha256Node(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function POST(req: NextRequest) {
  const password = (process.env.SITE_PASSWORD ?? "").trim();

  // If password not configured, skip and go home
  if (!password) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const contentType = req.headers.get("content-type") || "";
  let inputPwd = "";
  let from = "/";

  if (contentType.includes("application/json")) {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    inputPwd = String(body["password"] ?? "");
    from = String(body["from"] ?? "/") || "/";
  } else {
    const form = await req.formData();
    inputPwd = (form.get("password") ?? "").toString();
    from = (form.get("from") ?? "/").toString() || "/";
  }

  if (inputPwd !== password) {
    const url = new URL("/auth", req.url);
    if (from) url.searchParams.set("from", from);
    url.searchParams.set("e", "1");
    // Use 303 to convert POST to GET and avoid 405 on pages
    return NextResponse.redirect(url, 303);
  }

  const cookieValue = sha256Node(password);
  // sanitize redirect target to internal path only
  const safeFrom = typeof from === "string" && from.startsWith("/") && from !== "/auth" ? from : "/";
  const res = NextResponse.redirect(new URL(safeFrom, req.url), 303);
  res.cookies.set(AUTH_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
