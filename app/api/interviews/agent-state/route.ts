import { assertResumeApiAuthorized, unauthorizedResponse } from "@/lib/server/api-auth"
import { deleteInterviewAgentStates, getInterviewAgentState, saveInterviewAgentState } from "@/lib/server/interview-store"
import type { PersistedAgentState } from "@/lib/agent/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    await assertResumeApiAuthorized()
    const key = new URL(req.url).searchParams.get("key")
    if (!key) return Response.json({ error: "缺少 key" }, { status: 400 })
    return Response.json({ state: await getInterviewAgentState(key) })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "读取面试对话失败" }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    await assertResumeApiAuthorized()
    const body = (await req.json().catch(() => null)) as { key?: unknown; state?: PersistedAgentState } | null
    if (typeof body?.key !== "string" || !body.key) {
      return Response.json({ error: "缺少 key" }, { status: 400 })
    }
    await saveInterviewAgentState(body.key, body.state || {})
    return Response.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "保存面试对话失败" }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    await assertResumeApiAuthorized()
    const body = (await req.json().catch(() => null)) as { keys?: unknown } | null
    const keys = Array.isArray(body?.keys) ? body.keys.filter((key): key is string => typeof key === "string") : []
    return Response.json({ deleted: await deleteInterviewAgentStates(keys) })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "删除面试对话失败" }, { status: 500 })
  }
}
