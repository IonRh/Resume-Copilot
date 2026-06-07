import { assertResumeApiAuthorized, unauthorizedResponse } from "@/lib/server/api-auth"
import { loadTemplate } from "@/lib/server/resume-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    await assertResumeApiAuthorized()
    const { searchParams } = new URL(req.url)
    const type = searchParams.get("type") === "example" ? "example" : "default"
    return Response.json({ resumeData: await loadTemplate(type) })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "读取模板失败" }, { status: 500 })
  }
}
