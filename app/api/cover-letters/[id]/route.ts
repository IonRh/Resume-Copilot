import { assertResumeApiAuthorized, unauthorizedResponse } from "@/lib/server/api-auth"
import { deleteCoverLetter, getCoverLetter, upsertCoverLetter } from "@/lib/server/cover-letter-store"
import type { CoverLetterRecord } from "@/types/cover-letter"

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
    const letter = await getCoverLetter(await resolveId(ctx))
    if (!letter) return Response.json({ error: "未找到自荐信" }, { status: 404 })
    return Response.json({ letter })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "读取自荐信失败" }, { status: 500 })
  }
}

export async function PUT(req: Request, ctx: RouteContext) {
  try {
    await assertResumeApiAuthorized()
    const id = await resolveId(ctx)
    const body = (await req.json().catch(() => null)) as { record?: CoverLetterRecord } | null
    const record = body?.record
    if (!record || record.id !== id) return Response.json({ error: "缺少自荐信记录" }, { status: 400 })
    return Response.json({ letter: await upsertCoverLetter(record) })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "保存自荐信失败" }, { status: 500 })
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    await assertResumeApiAuthorized()
    const deleted = await deleteCoverLetter(await resolveId(ctx))
    return Response.json({ deleted })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "删除自荐信失败" }, { status: 500 })
  }
}
