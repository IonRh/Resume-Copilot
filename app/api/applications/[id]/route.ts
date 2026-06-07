import { assertResumeApiAuthorized, unauthorizedResponse } from "@/lib/server/api-auth"
import {
  deleteApplicationIds,
  getApplication,
  updateApplication,
  type ApplicationInput,
} from "@/lib/server/application-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

async function resolveId(ctx: RouteContext) {
  const params = await ctx.params
  return params.id
}

function bodyInput(body: unknown): ApplicationInput | null {
  if (!body || typeof body !== "object") return null
  const maybe = body as { application?: unknown }
  const candidate = maybe.application && typeof maybe.application === "object" ? maybe.application : body
  return candidate as ApplicationInput
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    await assertResumeApiAuthorized()
    const application = await getApplication(await resolveId(ctx))
    if (!application) return Response.json({ error: "未找到该投递记录" }, { status: 404 })
    return Response.json({ application })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "读取投递记录失败" }, { status: 500 })
  }
}

export async function PUT(req: Request, ctx: RouteContext) {
  try {
    await assertResumeApiAuthorized()
    const input = bodyInput(await req.json().catch(() => null))
    if (!input) return Response.json({ error: "缺少投递数据" }, { status: 400 })
    return Response.json({ application: await updateApplication(await resolveId(ctx), input) })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    const message = error instanceof Error ? error.message : "保存投递记录失败"
    return Response.json({ error: message }, { status: message.includes("未找到") ? 404 : 500 })
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    await assertResumeApiAuthorized()
    const deleted = await deleteApplicationIds([await resolveId(ctx)])
    if (deleted === 0) return Response.json({ error: "未找到该投递记录" }, { status: 404 })
    return Response.json({ deleted })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "删除投递记录失败" }, { status: 500 })
  }
}
