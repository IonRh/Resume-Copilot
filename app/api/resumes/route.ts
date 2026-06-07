import type { ResumeData } from "@/types/resume"
import { assertResumeApiAuthorized, unauthorizedResponse } from "@/lib/server/api-auth"
import { createResume, deleteResumeIds, listResumes } from "@/lib/server/resume-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function bodyResumeData(body: unknown): ResumeData | null {
  if (!body || typeof body !== "object") return null
  const maybe = body as Partial<ResumeData> & { resumeData?: unknown }
  const candidate = maybe.resumeData && typeof maybe.resumeData === "object"
    ? maybe.resumeData
    : body
  return candidate as ResumeData
}

export async function GET() {
  try {
    await assertResumeApiAuthorized()
    return Response.json({ resumes: await listResumes() })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "读取简历失败" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await assertResumeApiAuthorized()
    const resumeData = bodyResumeData(await req.json().catch(() => null))
    if (!resumeData) {
      return Response.json({ error: "缺少简历数据" }, { status: 400 })
    }
    return Response.json({ resume: await createResume(resumeData) }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "创建简历失败" }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    await assertResumeApiAuthorized()
    const body = (await req.json().catch(() => null)) as { ids?: unknown } | null
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : []
    if (ids.length === 0) {
      return Response.json({ error: "缺少要删除的简历 ID" }, { status: 400 })
    }
    return Response.json({ deleted: await deleteResumeIds(ids) })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "删除简历失败" }, { status: 500 })
  }
}
