import { createHash } from "node:crypto"
import { cookies } from "next/headers"

const AUTH_COOKIE = "site_auth"

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex")
}

export async function assertResumeApiAuthorized() {
  const password = (process.env.SITE_PASSWORD ?? "").trim()
  if (!password) return

  const cookieStore = await cookies()
  const actual = cookieStore.get(AUTH_COOKIE)?.value || ""
  const expected = hashPassword(password)
  if (actual !== expected) {
    throw new Error("UNAUTHORIZED")
  }
}

export function unauthorizedResponse() {
  return Response.json({ error: "未登录或登录已过期" }, { status: 401 })
}
