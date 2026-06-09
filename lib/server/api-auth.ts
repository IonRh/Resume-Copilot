import { cookies } from "next/headers"

import { AUTH_COOKIE, verifyAuthToken } from "@/lib/server/auth-users"

export async function getCurrentUsername(): Promise<string> {
  const cookieStore = await cookies()
  const token = cookieStore.get(AUTH_COOKIE)?.value || ""
  const username = await verifyAuthToken(token)
  if (!username) throw new Error("UNAUTHORIZED")
  return username
}

export async function assertResumeApiAuthorized(): Promise<string> {
  return getCurrentUsername()
}

export function unauthorizedResponse() {
  return Response.json({ error: "未登录或登录已过期" }, { status: 401 })
}
