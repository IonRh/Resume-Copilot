import { assertResumeApiAuthorized, unauthorizedResponse } from "@/lib/server/api-auth"
import { listInterviewSessions, upsertInterviewSession } from "@/lib/server/interview-store"
import type { InterviewSessionRecord } from "@/types/interview-session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await assertResumeApiAuthorized()
    return Response.json({ sessions: await listInterviewSessions() })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "读取面试记录失败" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await assertResumeApiAuthorized()
    const body = (await req.json().catch(() => null)) as { record?: InterviewSessionRecord } | InterviewSessionRecord | null
    const record = body && "record" in body ? body.record : body
    if (!record || typeof record !== "object" || !("id" in record) || typeof record.id !== "string") {
      return Response.json({ error: "缺少面试记录" }, { status: 400 })
    }
    return Response.json({ session: await upsertInterviewSession(record) }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "保存面试记录失败" }, { status: 500 })
  }
}
