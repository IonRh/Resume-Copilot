import { assertResumeApiAuthorized, unauthorizedResponse } from "@/lib/server/api-auth"
import { getInterviewReport, saveInterviewReport } from "@/lib/server/interview-store"
import type { StoredCampaignReport } from "@/types/interview-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ campaignId: string }> }

async function resolveCampaignId(ctx: RouteContext) {
  const params = await ctx.params
  return decodeURIComponent(params.campaignId)
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    await assertResumeApiAuthorized()
    return Response.json({ report: await getInterviewReport(await resolveCampaignId(ctx)) })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "读取面试报告失败" }, { status: 500 })
  }
}

export async function PUT(req: Request, ctx: RouteContext) {
  try {
    await assertResumeApiAuthorized()
    const campaignId = await resolveCampaignId(ctx)
    const body = (await req.json().catch(() => null)) as { report?: StoredCampaignReport } | null
    if (!body?.report || body.report.campaignId !== campaignId) {
      return Response.json({ error: "缺少面试报告" }, { status: 400 })
    }
    return Response.json({ report: await saveInterviewReport(body.report) })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
    return Response.json({ error: error instanceof Error ? error.message : "保存面试报告失败" }, { status: 500 })
  }
}
