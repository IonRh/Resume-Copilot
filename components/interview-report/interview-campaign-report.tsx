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
  isPicksComplete,
  loadInterviewAgentSessions,
  normalizeCampaignReportPick,
  saveCampaignReport,
  sessionsForRound,
  type InterviewAgentSessionOption,
} from "@/lib/interview-report"
import { loadInterviewSessions } from "@/lib/interview-sessions"
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

function pickValue(sessionId: string, agentSessionId?: string): string {
  return agentSessionId ? `${sessionId}:${agentSessionId}` : sessionId
}

export default function InterviewCampaignReport({ campaignId }: { campaignId: string }) {
  const router = useRouter()
  const { toast } = useToast()

  const [picks, setPicks] = useState<Partial<CampaignReportPicks>>({})
  const [stored, setStored] = useState<StoredCampaignReport | undefined>()
  const [generating, setGenerating] = useState(false)
  const [showPicker, setShowPicker] = useState(true)
  const [sessions, setSessions] = useState<import("@/types/interview-session").InterviewSessionRecord[]>([])
  const [agentSessionMap, setAgentSessionMap] = useState<Record<string, InterviewAgentSessionOption[]>>({})
  const [loading, setLoading] = useState(true)

  const reportableRounds = useMemo(
    () => INTERVIEW_ROUNDS.map((round) => ({ round, sessions: sessionsForRound(sessions, round.id) })).filter(
      (item) => item.sessions.length > 0,
    ),
    [sessions],
  )
  const picksComplete = isPicksComplete(picks)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void Promise.all([loadInterviewSessions(), getStoredCampaignReport(campaignId)])
      .then(async ([allSessions, existing]) => {
        const campaignSessions = getCampaignSessions(campaignId, allSessions)
        const entries = await Promise.all(
          campaignSessions.map(async (session) => [session.id, await loadInterviewAgentSessions(session)] as const),
        )
        if (cancelled) return
        setSessions(campaignSessions)
        setAgentSessionMap(Object.fromEntries(entries))
        setStored(existing)
        if (existing) setShowPicker(false)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [campaignId])

  useEffect(() => {
    if (sessions.length === 0) return
    const defaults: Partial<CampaignReportPicks> = {}
    for (const round of INTERVIEW_ROUNDS) {
      const list = sessionsForRound(sessions, round.id)
      if (list[0]) {
        const agentSession = agentSessionMap[list[0].id]?.[0]
        defaults[round.id] = { sessionId: list[0].id, agentSessionId: agentSession?.id }
      }
    }
    setPicks(defaults)
  }, [sessions])

  const generate = async () => {
    if (!picksComplete) {
      toast({ title: "请选择面试记录", description: "至少选择一场可复盘的模拟面试记录。", variant: "destructive" })
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

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-muted-foreground">
        <Icon icon="mdi:loading" className="agent-spin mr-1 inline h-4 w-4" /> 加载中…
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h2 className="text-lg font-semibold">没有找到面试记录</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          这次投递暂无可复盘的模拟面试记录，返回大厅看看其他投递。
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
              <p className="text-xs text-muted-foreground">选择要复盘的记录，交给报告 Agent 生成阶段报告</p>
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
              <h2 className="text-base font-semibold">选择代表记录</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                已完成或被关闭的投递不必凑满全部轮次，选择已有记录即可生成阶段性复盘。
              </p>
            </div>

            <div className="space-y-4">
              {reportableRounds.map(({ round, sessions: list }) => {
                return (
                  <div key={round.id} className="rounded-2xl border border-border bg-card p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <Badge variant="secondary">{round.label}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {list.reduce((total, session) => total + Math.max(agentSessionMap[session.id]?.length || 0, 1), 0)} 个会话可选
                      </span>
                    </div>
                    <div className="space-y-2">
                      {list.map((session) => {
                        const agentSessions = agentSessionMap[session.id] || []
                        const options = agentSessions.length
                          ? agentSessions.map((agentSession) => ({
                              id: pickValue(session.id, agentSession.id),
                              sessionId: session.id,
                              agentSessionId: agentSession.id,
                              title: agentSession.title,
                              updatedAt: agentSession.updatedAt || session.updatedAt,
                              turnCount: agentSession.turnCount,
                            }))
                          : [
                              {
                                id: pickValue(session.id),
                                sessionId: session.id,
                                agentSessionId: undefined,
                                title: "当前会话",
                                updatedAt: session.updatedAt,
                                turnCount: session.questionCount || 0,
                              },
                            ]

                        return options.map((option) => {
                          const selectedPick = normalizeCampaignReportPick(picks[round.id])
                          const selected =
                            selectedPick?.sessionId === option.sessionId &&
                            selectedPick?.agentSessionId === option.agentSessionId
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() =>
                                setPicks((prev) => ({
                                  ...prev,
                                  [round.id]: { sessionId: option.sessionId, agentSessionId: option.agentSessionId },
                                }))
                              }
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
                                  {option.title} · {formatDateTime(option.updatedAt)}
                                  {option.turnCount ? ` · ${option.turnCount} 条对话` : ""}
                                  {session.questionCount ? ` · ${session.questionCount} 题` : ""}
                                  {session.status === "completed"
                                    ? " · 已完成"
                                    : session.status === "terminated"
                                      ? " · 已关闭"
                                      : " · 进行中"}
                                </span>
                              </span>
                            </button>
                          )
                        })
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
