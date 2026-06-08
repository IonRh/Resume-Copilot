import { assertResumeApiAuthorized, unauthorizedResponse } from "@/lib/server/api-auth"
import {
  deleteInterviewAgentStates,
  deleteInterviewSession,
  getInterviewSession,
  patchInterviewSession,
  upsertInterviewSession,
} from "@/lib/server/interview-store"
import type { InterviewSessionRecord } from "@/types/interview-session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

async function resolveId(ctx: RouteContext) {
  const params = await ctx.params
  return params.id
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    await assertResumeApiAuthorized()
    const session = await getInterviewSession(await resolveId(ctx))
    if (!session) return Response.json({ error: "未找到面试记录" }, { status: 404 })
    return Response.json({ session })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "读取面试记录失败" }, { status: 500 })
  }
}

export async function PUT(req: Request, ctx: RouteContext) {
  try {
    await assertResumeApiAuthorized()
    const id = await resolveId(ctx)
    const body = (await req.json().catch(() => null)) as
      | { action?: string; record?: InterviewSessionRecord; keys?: string[] }
      | null

    if (body?.action === "touch") {
      const session = await patchInterviewSession(id, (record) => ({ ...record, updatedAt: new Date().toISOString() }))
      if (!session) return Response.json({ error: "未找到面试记录" }, { status: 404 })
      return Response.json({ session })
    }

    if (body?.action === "terminate") {
      const session = await patchInterviewSession(id, (record) => ({
        ...record,
        status: "terminated",
        failCount: (record.failCount || 0) + 1,
        updatedAt: new Date().toISOString(),
      }))
      if (!session) return Response.json({ error: "未找到面试记录" }, { status: 404 })
      return Response.json({ session })
    }

    const record = body?.record
    if (!record || record.id !== id) return Response.json({ error: "缺少面试记录" }, { status: 400 })
    return Response.json({ session: await upsertInterviewSession(record) })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "保存面试记录失败" }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: RouteContext) {
  try {
    await assertResumeApiAuthorized()
    const id = await resolveId(ctx)
    const body = (await req.json().catch(() => null)) as { keys?: string[] } | null
    const deleted = await deleteInterviewSession(id)
    const keys = Array.isArray(body?.keys) ? body.keys.filter((key): key is string => typeof key === "string") : []
    const deletedAgentStates = await deleteInterviewAgentStates(keys)
    return Response.json({ deleted, deletedAgentStates })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "删除面试记录失败" }, { status: 500 })
  }
}
