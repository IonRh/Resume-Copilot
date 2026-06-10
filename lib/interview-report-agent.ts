import type { CampaignReportPicks, FullInterviewReport } from "@/types/interview-report"

export async function generateCampaignReport(args: {
  campaignId: string
  picks: CampaignReportPicks
  signal?: AbortSignal
}): Promise<FullInterviewReport> {
  const res = await fetch("/api/interviews/reports/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      campaignId: args.campaignId,
      picks: args.picks,
    }),
    signal: args.signal,
  })

  const data = (await res.json().catch(() => ({}))) as { report?: FullInterviewReport; error?: string }
  if (!res.ok || !data.report) {
    throw new Error(data.error || "生成面试报告失败")
  }
  return data.report
}
