"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getStoredCampaignReport, listReportReadyCampaigns } from "@/lib/interview-report"

export default function InterviewReportHall() {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState(listReportReadyCampaigns())

  const refresh = useCallback(() => {
    setCampaigns(listReportReadyCampaigns())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="min-h-screen bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className="brand-gradient-bg grid h-9 w-9 place-items-center rounded-xl">
            <Icon icon="mdi:file-chart-outline" className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">面试报告大厅</h1>
            <p className="text-xs text-muted-foreground">五轮均已完成后，可为每次投递生成综合报告</p>
          </div>
        </div>
        <Button variant="outline" className="gap-2 bg-transparent" onClick={() => router.push("/interviews")}>
          <Icon icon="mdi:arrow-left" className="h-4 w-4" /> 返回模拟面试
        </Button>
      </div>

      <div className="space-y-3 px-4 pb-6">
        {campaigns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center">
            <Icon icon="mdi:clipboard-text-clock-outline" className="mx-auto h-10 w-10 text-primary" />
            <h2 className="mt-4 text-base font-semibold">还没有可生成报告的投递</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              完成 HR 面、技术面、场景面、行为面、Leader 面各至少一场后，会出现在这里。
            </p>
          </div>
        ) : (
          campaigns.map((campaign) => {
            const stored = getStoredCampaignReport(campaign.campaignId)
            return (
              <div
                key={campaign.campaignId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-base font-semibold">{campaign.title}</h3>
                    {stored ? <Badge variant="secondary">已有报告</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{campaign.resumeTitle}</p>
                </div>
                <Button
                  className="brand-gradient-bg gap-2 border-0"
                  onClick={() => router.push(`/interviews/report/${campaign.campaignId}`)}
                >
                  <Icon icon="mdi:file-chart-outline" className="h-4 w-4" />
                  {stored ? "查看报告" : "选择记录并生成"}
                </Button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
