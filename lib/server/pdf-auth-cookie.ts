export function getAuthCookieValue(req: Request): string {
  const cookieHeader = req.headers.get("cookie") || ""
  const pair = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("site_auth="))
  return pair ? decodeURIComponent(pair.slice("site_auth=".length)) : ""
}
