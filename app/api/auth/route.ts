import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE, createUser, verifyUser } from "@/lib/server/auth-users";

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
    const url = new URL("/auth", req.url);
    if (from) url.searchParams.set("from", from);
    url.searchParams.set("e", error instanceof Error ? error.message : "账号创建失败");
    return NextResponse.redirect(url, 303);
  }

  if (!cookieValue) {
    const url = new URL("/auth", req.url);
    if (from) url.searchParams.set("from", from);
    url.searchParams.set("e", "用户名或密码错误");
    // Use 303 to convert POST to GET and avoid 405 on pages
    return NextResponse.redirect(url, 303);
  }

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
