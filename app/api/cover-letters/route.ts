import { assertResumeApiAuthorized, unauthorizedResponse } from "@/lib/server/api-auth"
import { listCoverLetters, upsertCoverLetter } from "@/lib/server/cover-letter-store"
import type { CoverLetterRecord } from "@/types/cover-letter"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await assertResumeApiAuthorized()
    return Response.json({ letters: await listCoverLetters() })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "读取自荐信失败" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await assertResumeApiAuthorized()
    const body = (await req.json().catch(() => null)) as { record?: CoverLetterRecord } | CoverLetterRecord | null
    const record = body && "record" in body ? body.record : body
    if (!record || typeof record !== "object" || !("id" in record) || typeof record.id !== "string") {
      return Response.json({ error: "缺少自荐信记录" }, { status: 400 })
    }
    return Response.json({ letter: await upsertCoverLetter(record) }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "保存自荐信失败" }, { status: 500 })
  }
}
