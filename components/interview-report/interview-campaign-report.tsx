"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { INTERVIEW_ROUNDS } from "@/lib/agent/interview-rounds"
import {
  getCampaignSessions,
  getStoredCampaignReport,
  isCampaignReadyForReport,
  isPicksComplete,
  saveCampaignReport,
  sessionsForRound,
} from "@/lib/interview-report"
import { generateCampaignReport } from "@/lib/interview-report-agent"
import type { CampaignReportPicks, StoredCampaignReport } from "@/types/interview-report"
import InterviewReportView from "@/components/interview-report/interview-report-view"

function formatDateTime(iso?: string): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function InterviewCampaignReport({ campaignId }: { campaignId: string }) {
  const router = useRouter()
  const { toast } = useToast()

  const [picks, setPicks] = useState<Partial<CampaignReportPicks>>({})
  const [stored, setStored] = useState<StoredCampaignReport | undefined>()
  const [generating, setGenerating] = useState(false)
  const [showPicker, setShowPicker] = useState(true)

  const sessions = useMemo(() => getCampaignSessions(campaignId), [campaignId])
  const ready = isCampaignReadyForReport(sessions)
  const picksComplete = isPicksComplete(picks)

  useEffect(() => {
    const existing = getStoredCampaignReport(campaignId)
    setStored(existing)
    if (existing) setShowPicker(false)
  }, [campaignId])

  useEffect(() => {
    if (!ready || sessions.length === 0) return
    const defaults: Partial<CampaignReportPicks> = {}
    for (const round of INTERVIEW_ROUNDS) {
      const list = sessionsForRound(sessions, round.id)
      if (list[0]) defaults[round.id] = list[0].id
    }
    setPicks(defaults)
  }, [ready, sessions])

  const generate = async () => {
    if (!picksComplete) {
      toast({ title: "请选择每一轮", description: "每轮需选定一场最满意的模拟面试记录。", variant: "destructive" })
      return
    }
    setGenerating(true)
    try {
      const report = await generateCampaignReport({ picks, campaignSessions: sessions })
      const input = sessions[0]
      const entry: StoredCampaignReport = {
        campaignId,
        title: report.title,
        resumeTitle: input?.resumeTitle || "未命名",
        generatedAt: new Date().toISOString(),
        picks,
        report,
      }
      saveCampaignReport(entry)
      setStored(entry)
      setShowPicker(false)
      toast({ title: "报告已生成", description: "可以查看完整面试报告了。" })
    } catch (error) {
      toast({
        title: "生成失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setGenerating(false)
    }
  }

  if (!ready) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h2 className="text-lg font-semibold">暂无法生成报告</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          需要完成全部 5 轮模拟面试（每轮至少一场记录）后，才能生成综合报告。
        </p>
        <Button className="mt-6" variant="outline" onClick={() => router.push("/interviews")}>
          返回模拟面试
        </Button>
      </div>
    )
  }

  const title = sessions[0]?.title || "模拟面试"

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/40">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <Button variant="outline" className="gap-2 bg-transparent" onClick={() => router.push("/interviews/report")}>
              <Icon icon="mdi:arrow-left" className="h-4 w-4" /> 面试报告大厅
            </Button>
            <div>
              <h1 className="text-lg font-semibold">{title}</h1>
              <p className="text-xs text-muted-foreground">选择每轮最满意的记录，交给报告 Agent 生成综合报告</p>
            </div>
          </div>
          {stored && !showPicker ? (
            <Button variant="outline" className="gap-2 bg-transparent" onClick={() => setShowPicker(true)}>
              <Icon icon="mdi:playlist-edit" className="h-4 w-4" /> 重新选择
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        {showPicker ? (
          <>
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-base font-semibold">选择每轮代表记录</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                同一轮可能有多场练习，请各选一场你认为表现最好的，再生成报告。
              </p>
            </div>

            <div className="space-y-4">
              {INTERVIEW_ROUNDS.map((round) => {
                const list = sessionsForRound(sessions, round.id)
                return (
                  <div key={round.id} className="rounded-2xl border border-border bg-card p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <Badge variant="secondary">{round.label}</Badge>
                      <span className="text-xs text-muted-foreground">{list.length} 场可选</span>
                    </div>
                    <div className="space-y-2">
                      {list.map((session) => {
                        const selected = picks[round.id] === session.id
                        return (
                          <button
                            key={session.id}
                            type="button"
                            onClick={() => setPicks((prev) => ({ ...prev, [round.id]: session.id }))}
                            className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                              selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
                            }`}
                          >
                            <span
                              className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                                selected ? "border-primary bg-primary" : "border-muted-foreground/40"
                              }`}
                            >
                              {selected ? <Icon icon="mdi:check" className="h-3 w-3 text-primary-foreground" /> : null}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium">{session.title}</span>
                              <span className="mt-1 block text-xs text-muted-foreground">
                                {formatDateTime(session.updatedAt)}
                                {session.questionCount ? ` · ${session.questionCount} 题` : ""}
                                {session.status === "completed" ? " · 已完成" : " · 进行中"}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                className="brand-gradient-bg gap-2 border-0"
                disabled={!picksComplete || generating}
                onClick={() => void generate()}
              >
                {generating ? (
                  <>
                    <Icon icon="mdi:loading" className="agent-spin h-4 w-4" /> 报告生成中…
                  </>
                ) : (
                  <>
                    <Icon icon="mdi:file-chart-outline" className="h-4 w-4" /> 生成面试报告
                  </>
                )}
              </Button>
              {stored ? (
                <Button variant="outline" className="bg-transparent" onClick={() => setShowPicker(false)}>
                  查看已有报告
                </Button>
              ) : null}
            </div>
          </>
        ) : null}

        {stored && !showPicker ? (
          <InterviewReportView report={stored.report} />
        ) : null}
      </div>
    </div>
  )
}
