import type { ResumeData } from "@/types/resume"
import { assertResumeApiAuthorized, unauthorizedResponse } from "@/lib/server/api-auth"
import { deleteResumeIds, getResume, updateResume, updateResumeDisplayName } from "@/lib/server/resume-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

async function resolveId(ctx: RouteContext) {
  const params = await ctx.params
  return params.id
}

function parseResumeBody(body: unknown): { resumeData: ResumeData; displayName?: string } | null {
  if (!body || typeof body !== "object") return null
  const maybe = body as Partial<ResumeData> & { resumeData?: unknown; displayName?: unknown }
  const candidate = maybe.resumeData && typeof maybe.resumeData === "object"
    ? maybe.resumeData
    : body
  return {
    resumeData: candidate as ResumeData,
    displayName: typeof maybe.displayName === "string" ? maybe.displayName : undefined,
  }
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    await assertResumeApiAuthorized()
    const resume = await getResume(await resolveId(ctx))
    if (!resume) return Response.json({ error: "未找到该简历" }, { status: 404 })
    return Response.json({ resume })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "读取简历失败" }, { status: 500 })
  }
}

export async function PUT(req: Request, ctx: RouteContext) {
  try {
    await assertResumeApiAuthorized()
    const body = await req.json().catch(() => null)
    if (
      body &&
      typeof body === "object" &&
      "displayName" in body &&
      !("resumeData" in body) &&
      !("title" in body)
    ) {
      const displayName = (body as { displayName?: unknown }).displayName
      if (typeof displayName !== "string" || !displayName.trim()) {
        return Response.json({ error: "简历名称不能为空" }, { status: 400 })
      }
      return Response.json({ resume: await updateResumeDisplayName(await resolveId(ctx), displayName) })
    }

    const payload = parseResumeBody(body)
    if (!payload) {
      return Response.json({ error: "缺少简历数据" }, { status: 400 })
    }
    return Response.json({ resume: await updateResume(await resolveId(ctx), payload.resumeData, payload.displayName) })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    const message = error instanceof Error ? error.message : "保存简历失败"
    return Response.json({ error: message }, { status: message.includes("未找到") ? 404 : 500 })
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    await assertResumeApiAuthorized()
    const deleted = await deleteResumeIds([await resolveId(ctx)])
    if (deleted === 0) return Response.json({ error: "未找到该简历" }, { status: 404 })
    return Response.json({ deleted })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "删除简历失败" }, { status: 500 })
  }
}
