import { assertResumeApiAuthorized, unauthorizedResponse } from "@/lib/server/api-auth"
import {
  createApplication,
  deleteApplicationIds,
  listApplications,
  type ApplicationInput,
} from "@/lib/server/application-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function bodyInput(body: unknown): ApplicationInput | null {
  if (!body || typeof body !== "object") return null
  const maybe = body as { application?: unknown }
  const candidate = maybe.application && typeof maybe.application === "object" ? maybe.application : body
  return candidate as ApplicationInput
}

export async function GET() {
  try {
    await assertResumeApiAuthorized()
    return Response.json({ applications: await listApplications() })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "读取投递记录失败" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await assertResumeApiAuthorized()
    const input = bodyInput(await req.json().catch(() => null))
    if (!input) return Response.json({ error: "缺少投递数据" }, { status: 400 })
    return Response.json({ application: await createApplication(input) }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "创建投递记录失败" }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    await assertResumeApiAuthorized()
    const body = (await req.json().catch(() => null)) as { ids?: unknown } | null
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : []
    if (ids.length === 0) return Response.json({ error: "缺少要删除的投递 ID" }, { status: 400 })
    return Response.json({ deleted: await deleteApplicationIds(ids) })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "删除投递记录失败" }, { status: 500 })
  }
}
