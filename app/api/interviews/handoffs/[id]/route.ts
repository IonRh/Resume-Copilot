import { assertResumeApiAuthorized, unauthorizedResponse } from "@/lib/server/api-auth"
import { deleteInterviewHandoff, getInterviewHandoff, saveInterviewHandoff } from "@/lib/server/interview-store"
import type { InterviewRoundHandoff } from "@/types/interview-session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

async function resolveId(ctx: RouteContext) {
  const params = await ctx.params
  return decodeURIComponent(params.id)
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    await assertResumeApiAuthorized()
    return Response.json({ handoff: await getInterviewHandoff(await resolveId(ctx)) })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "读取交接评价失败" }, { status: 500 })
  }
}

export async function PUT(req: Request, ctx: RouteContext) {
  try {
    await assertResumeApiAuthorized()
    const id = await resolveId(ctx)
    const body = (await req.json().catch(() => null)) as { handoff?: InterviewRoundHandoff } | null
    if (!body?.handoff || body.handoff.fromSessionId !== id) {
      return Response.json({ error: "缺少交接评价" }, { status: 400 })
    }
    return Response.json({ handoff: await saveInterviewHandoff(body.handoff) })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "保存交接评价失败" }, { status: 500 })
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    await assertResumeApiAuthorized()
    return Response.json({ deleted: await deleteInterviewHandoff(await resolveId(ctx)) })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "删除交接评价失败" }, { status: 500 })
  }
}
