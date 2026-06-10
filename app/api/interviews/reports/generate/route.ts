import { assertResumeApiAuthorized, unauthorizedResponse } from "@/lib/server/api-auth"
import { generateCampaignReportOnServer } from "@/lib/server/interview-report-generate"
import type { CampaignReportPicks } from "@/types/interview-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(req: Request) {
  try {
    await assertResumeApiAuthorized()
    const body = (await req.json().catch(() => null)) as {
      campaignId?: unknown
      picks?: CampaignReportPicks
    } | null

    const campaignId = typeof body?.campaignId === "string" ? body.campaignId.trim() : ""
    if (!campaignId) {
      return Response.json({ error: "缺少 campaignId" }, { status: 400 })
    }
    if (!body?.picks || typeof body.picks !== "object") {
      return Response.json({ error: "缺少 picks" }, { status: 400 })
    }

    const report = await generateCampaignReportOnServer({
      campaignId,
      picks: body.picks,
      signal: req.signal,
    })
    return Response.json({ report })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json(
      { error: error instanceof Error ? error.message : "生成面试报告失败" },
      { status: 502 },
    )
  }
}
