import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE, createUser, verifyUser } from "@/lib/server/auth-users";

function getRequestOrigin(req: NextRequest) {
  const publicOrigin = (process.env.PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_APP_ORIGIN || "").trim();
  if (publicOrigin) return publicOrigin.replace(/\/+$/, "");

  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim();
  const proto = (req.headers.get("x-forwarded-proto") || "http").split(",")[0].trim() || "http";
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

function redirectTo(req: NextRequest, location: string, status = 303) {
  const target = location.startsWith("http://") || location.startsWith("https://")
    ? location
    : `${getRequestOrigin(req)}${location.startsWith("/") ? location : `/${location}`}`;
  return new NextResponse(null, {
    status,
    headers: { Location: target },
  });
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";
  let inputPwd = "";
  let username = "";
  let mode = "login";
  let from = "/";

  if (contentType.includes("application/json")) {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    username = String(body["username"] ?? "");
    inputPwd = String(body["password"] ?? "");
    mode = String(body["mode"] ?? "login");
    from = String(body["from"] ?? "/") || "/";
  } else {
    const form = await req.formData();
    username = (form.get("username") ?? "").toString();
    inputPwd = (form.get("password") ?? "").toString();
    mode = (form.get("mode") ?? "login").toString();
    from = (form.get("from") ?? "/").toString() || "/";
  }

  let cookieValue = "";
  try {
    cookieValue = mode === "register"
      ? await createUser(username, inputPwd)
      : (await verifyUser(username, inputPwd)) || "";
  } catch (error) {
    const url = new URL("/auth", "http://internal.local");
    if (from) url.searchParams.set("from", from);
    url.searchParams.set("e", error instanceof Error ? error.message : "账号创建失败");
    return redirectTo(req, `${url.pathname}${url.search}`);
  }

  if (!cookieValue) {
    const url = new URL("/auth", "http://internal.local");
    if (from) url.searchParams.set("from", from);
    url.searchParams.set("e", "用户名或密码错误");
    // Use 303 to convert POST to GET and avoid 405 on pages
    return redirectTo(req, `${url.pathname}${url.search}`);
  }

  // sanitize redirect target to internal path only
  const safeFrom = typeof from === "string" && from.startsWith("/") && from !== "/auth" ? from : "/";
  const res = redirectTo(req, safeFrom);
  const isSecureOrigin = getRequestOrigin(req).startsWith("https://");
  res.cookies.set(AUTH_COOKIE, cookieValue, {
    httpOnly: true,
    secure: isSecureOrigin,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
