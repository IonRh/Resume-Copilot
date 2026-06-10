"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import type { StoredResume } from "@/types/resume"
import type { InterviewRoundHandoff, InterviewSessionRecord } from "@/types/interview-session"
import { getAllResumes, getCachedResumes } from "@/lib/storage"
import { getNextRound, getRoundIndex } from "@/lib/agent/interview-rounds"
import {
  createNextRoundSession,
  deleteInterviewSession,
  deleteInterviewSessionStorage,
  loadInterviewSessions,
} from "@/lib/interview-sessions"
import {
  deleteStoredRoundHandoff,
  generateRoundHandoff,
  getStoredRoundHandoff,
} from "@/lib/interview-handoff"
import {
  groupSessionsByCampaign,
  hasReportableInterview,
  loadInterviewAgentSessions,
  type InterviewAgentSessionOption,
} from "@/lib/interview-report"
import { Markdown } from "@/components/agent/markdown"
import CareerIntakeDialog from "@/components/agent/career-intake-dialog"

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

function statusMeta(status: InterviewSessionRecord["status"]) {
  if (status === "completed") {
    return { label: "已完成", className: "bg-emerald-100 text-emerald-700 border-emerald-200" }
  }
  if (status === "terminated") {
    return { label: "面试失利", className: "bg-red-100 text-red-700 border-red-200" }
  }
  return { label: "进行中", className: "bg-amber-100 text-amber-700 border-amber-200" }
}

function playModeLabel(mode: InterviewSessionRecord["playMode"]) {
  return mode === "simulation" ? "真实模拟" : "学习练手"
}

function handoffCacheKey(interviewSessionId: string, agentSessionId: string): string {
  return agentSessionId === interviewSessionId ? interviewSessionId : `${interviewSessionId}:${agentSessionId}`
}

interface CampaignGroup {
  campaignId: string
  title: string
  resumeTitle: string
  playMode: InterviewSessionRecord["playMode"]
  sessions: InterviewSessionRecord[]
  updatedAt: string
  hasInProgress: boolean
  distinctRoundCount: number
}

function sortCampaignSessions(sessions: InterviewSessionRecord[]): InterviewSessionRecord[] {
  return [...sessions].sort((a, b) => {
    const roundDiff = getRoundIndex(a.roundId) - getRoundIndex(b.roundId)
    if (roundDiff !== 0) return roundDiff
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}

function buildCampaignGroups(sessions: InterviewSessionRecord[]): CampaignGroup[] {
  const map = groupSessionsByCampaign(sessions)
  return Array.from(map.entries())
    .map(([campaignId, list]) => {
      const sorted = sortCampaignSessions(list)
      const latest = [...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
      const distinctRoundCount = new Set(list.map((item) => item.roundId)).size
      return {
        campaignId,
        title: latest.title,
        resumeTitle: latest.resumeTitle,
        playMode: latest.playMode,
        sessions: sorted,
        updatedAt: latest.updatedAt,
        hasInProgress: list.some((item) => item.status === "in_progress"),
        distinctRoundCount,
      }
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

function campaignStatusMeta(sessions: InterviewSessionRecord[]) {
  if (sessions.some((item) => item.status === "in_progress")) return statusMeta("in_progress")
  if (sessions.every((item) => item.status === "completed")) return statusMeta("completed")
  if (sessions.some((item) => item.status === "terminated")) return statusMeta("terminated")
  return statusMeta("in_progress")
}

function pickContinueSession(sessions: InterviewSessionRecord[]): InterviewSessionRecord | null {
  if (!sessions.length) return null
  const inProgress = sessions.filter((item) => item.status === "in_progress")
  const pool = inProgress.length ? inProgress : sessions
  return [...pool].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
}

function sessionMatchesKeyword(session: InterviewSessionRecord, needle: string): boolean {
  return (
    session.title.toLowerCase().includes(needle) ||
    session.resumeTitle.toLowerCase().includes(needle) ||
    session.roundLabel.toLowerCase().includes(needle) ||
    (session.briefingPreview || "").toLowerCase().includes(needle)
  )
}

export default function InterviewHub() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()

  const [resumes, setResumes] = useState<StoredResume[]>([])
  const [sessions, setSessions] = useState<InterviewSessionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState("")
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [defaultResumeId, setDefaultResumeId] = useState<string | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<InterviewSessionRecord | null>(null)
  const [handoffParent, setHandoffParent] = useState<InterviewSessionRecord | null>(null)
  const [handoffSourceId, setHandoffSourceId] = useState("")
  const [handoff, setHandoff] = useState<InterviewRoundHandoff | null>(null)
  const [handoffVisible, setHandoffVisible] = useState(false)
  const [handoffBusy, setHandoffBusy] = useState(false)
  const [handoffError, setHandoffError] = useState<string | null>(null)
  const [handoffSourceOptions, setHandoffSourceOptions] = useState<InterviewAgentSessionOption[]>([])
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(() => new Set())
  const expandInitializedRef = useRef(false)

  const refreshSessions = useCallback(async () => {
    setSessions(await loadInterviewSessions())
  }, [])

  const refresh = useCallback(() => {
    let cancelled = false
    setLoading(true)
    void getAllResumes()
      .then((list) => {
        if (!cancelled) setResumes(list)
      })
      .catch((e) => {
        if (!cancelled) {
          toast({
            title: "读取失败",
            description: e instanceof Error ? e.message : "无法读取简历列表",
            variant: "destructive",
          })
        }
      })
      .then(async () => {
        if (!cancelled) {
          await refreshSessions()
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refreshSessions, toast])

  useEffect(() => {
    const cached = getCachedResumes()
    if (cached?.length) setResumes(cached)
    return refresh()
  }, [refresh])

  useEffect(() => {
    const resumeParam = searchParams.get("resume")
    if (resumeParam && resumes.some((item) => item.id === resumeParam)) {
      setDefaultResumeId(resumeParam)
    }
  }, [resumes, searchParams])

  const mostRecent = resumes[0]

  const campaignGroups = useMemo(() => buildCampaignGroups(sessions), [sessions])

  const visibleCampaigns = useMemo(() => {
    const needle = keyword.trim().toLowerCase()
    if (!needle) return campaignGroups
    return campaignGroups.filter(
      (group) =>
        group.title.toLowerCase().includes(needle) ||
        group.resumeTitle.toLowerCase().includes(needle) ||
        group.sessions.some((session) => sessionMatchesKeyword(session, needle)),
    )
  }, [campaignGroups, keyword])

  useEffect(() => {
    if (loading || expandInitializedRef.current || campaignGroups.length === 0) return
    expandInitializedRef.current = true
    const initial = new Set<string>()
    for (const group of campaignGroups) {
      if (group.hasInProgress) initial.add(group.campaignId)
    }
    if (campaignGroups.length === 1) initial.add(campaignGroups[0].campaignId)
    setExpandedCampaigns(initial)
  }, [campaignGroups, loading])

  const openIntake = useCallback(
    (resumeId?: string) => {
      if (!mostRecent) {
        toast({ title: "还没有简历", description: "请先创建一份简历，再发起模拟面试。" })
        return
      }
      setDefaultResumeId(resumeId ?? mostRecent.id)
      setIntakeOpen(true)
    },
    [mostRecent, toast],
  )

  const goToSession = useCallback(
    (session: InterviewSessionRecord) => {
      router.push(`/career/interview/${session.resumeId}?session=${encodeURIComponent(session.id)}`)
    },
    [router],
  )

  const continueSession = useCallback(
    (session: InterviewSessionRecord) => {
      goToSession(session)
    },
    [goToSession],
  )

  const openHandoffDialog = useCallback(
    async (session: InterviewSessionRecord) => {
      const nextRound = getNextRound(session.roundId)
      if (!nextRound) {
        toast({ title: "已是最后一轮", description: "Leader 面是本次模拟面试的最后一轮。" })
        return
      }
      const agentSessions = await loadInterviewAgentSessions(session)
      const sourceId = agentSessions[0]?.id || session.id
      const options = agentSessions.length
        ? agentSessions.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
        : [
            {
              id: session.id,
              title: "当前会话",
              updatedAt: session.updatedAt,
              turnCount: session.questionCount || 0,
            },
          ]
      setHandoffSourceOptions(options)
      setHandoffParent(session)
      setHandoffSourceId(sourceId)
      setHandoff((await getStoredRoundHandoff(handoffCacheKey(session.id, sourceId))) || (await getStoredRoundHandoff(session.id)) || null)
      setHandoffVisible(false)
      setHandoffError(null)
    },
    [toast],
  )

  const selectedHandoffSource = useMemo(
    () => handoffSourceOptions.find((item) => item.id === handoffSourceId),
    [handoffSourceId, handoffSourceOptions],
  )

  const generateSelectedHandoff = useCallback(async (source = selectedHandoffSource, force = false) => {
    if (!source || !handoffParent) return null
    const handoffKey = handoffCacheKey(handoffParent.id, source.id)
    const cached = force ? undefined : await getStoredRoundHandoff(handoffKey)
    if (cached) {
      setHandoff(cached)
      return cached
    }

    setHandoffBusy(true)
    setHandoffError(null)
    try {
      const next = await generateRoundHandoff({
        session: handoffParent,
        agentSessionId: source.id === handoffParent.id ? undefined : source.id,
      })
      setHandoff(next)
      return next
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成交接评价失败"
      setHandoffError(message)
      return null
    } finally {
      setHandoffBusy(false)
    }
  }, [handoffParent, selectedHandoffSource])

  useEffect(() => {
    if (!handoffParent || !handoffSourceId) return
    void getStoredRoundHandoff(handoffCacheKey(handoffParent.id, handoffSourceId)).then((cached) => setHandoff(cached || null))
    setHandoffVisible(false)
    setHandoffError(null)
  }, [handoffParent, handoffSourceId])

  useEffect(() => {
    if (!handoffParent || !selectedHandoffSource || handoff) return
    void generateSelectedHandoff()
  }, [generateSelectedHandoff, handoff, handoffParent, selectedHandoffSource])

  const startNextRoundWithHandoff = useCallback(async () => {
    if (!handoffParent) return
    const nextRound = getNextRound(handoffParent.roundId)
    if (!nextRound) return

    const handoffToUse = handoff || (await generateSelectedHandoff())
    if (!handoffToUse) return

    const nextSession = await createNextRoundSession(handoffParent, handoffToUse)
      if (!nextSession) {
        toast({
          title: "无法进入下一轮",
          description: "缺少岗位设定信息，请重新发起并完成 intake。",
          variant: "destructive",
        })
        return
      }
      goToSession(nextSession)
      setHandoffParent(null)
      setHandoff(null)
      void refreshSessions()
      toast({ title: "已带入交接评价", description: `${nextRound.label} 已就绪。` })
    },
    [generateSelectedHandoff, goToSession, handoff, handoffParent, refreshSessions, toast],
  )

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    await deleteInterviewSessionStorage(deleteTarget.resumeId, deleteTarget.id)
    await deleteInterviewSession(deleteTarget.id)
    setDeleteTarget(null)
    void refreshSessions()
    toast({ title: "已删除", description: "该场模拟面试记录已移除。" })
  }, [deleteTarget, refreshSessions, toast])

  return (
    <div className="min-h-screen bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className="brand-gradient-bg grid h-9 w-9 place-items-center rounded-xl">
            <Icon icon="mdi:account-voice" className="h-5 w-5" />
          </span>
          <h1 className="text-lg font-semibold">模拟面试</h1>
          <Badge variant="secondary">
            {campaignGroups.length} 场模拟 · {sessions.length} 轮记录
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2 bg-transparent" onClick={() => router.push("/resumes")}>
            <Icon icon="mdi:arrow-left" className="h-4 w-4" /> 返回
          </Button>
          <Button variant="outline" className="gap-2 bg-transparent" onClick={() => router.push("/interviews/report")}>
            <Icon icon="mdi:file-chart-outline" className="h-4 w-4" /> 面试报告
          </Button>
          <Button className="brand-gradient-bg gap-2 border-0" onClick={() => openIntake(defaultResumeId)}>
            <Icon icon="mdi:plus-circle-outline" className="h-4 w-4" /> 发起面试
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3">
        {[
          { label: "模拟场次", value: campaignGroups.length, icon: "mdi:clipboard-text-outline", tint: "text-blue-600" },
          {
            label: "进行中",
            value: sessions.filter((item) => item.status === "in_progress").length,
            icon: "mdi:progress-clock",
            tint: "text-amber-600",
          },
          {
            label: "已完成",
            value: sessions.filter((item) => item.status === "completed").length,
            icon: "mdi:check-decagram-outline",
            tint: "text-emerald-600",
          },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border bg-card p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon icon={card.icon} className={`h-4 w-4 ${card.tint}`} />
              {card.label}
            </div>
            <div className="mt-1 text-2xl font-semibold">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Icon
            icon="mdi:magnify"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索岗位、公司或简历名称…"
            className="pl-9"
          />
        </div>
      </div>

      <div className="space-y-3 px-4 pb-6">
        {loading ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            <Icon icon="mdi:loading" className="agent-spin mr-1 inline h-4 w-4" /> 加载中…
          </div>
        ) : visibleCampaigns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-muted">
              <Icon icon="mdi:account-voice" className="h-7 w-7 text-primary" />
            </div>
            <h2 className="mt-4 text-base font-semibold">{sessions.length ? "没有匹配的记录" : "还没有模拟面试记录"}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {sessions.length
                ? "换个关键词试试，或发起一场新的模拟面试。"
                : "点击「发起面试」，选择简历并设定目标岗位，即可开始练习。"}
            </p>
            {!sessions.length ? (
              <Button className="brand-gradient-bg mt-5 gap-2 border-0" onClick={() => openIntake(defaultResumeId)}>
                <Icon icon="mdi:plus-circle-outline" className="h-4 w-4" /> 发起面试
              </Button>
            ) : null}
          </div>
        ) : (
          visibleCampaigns.map((group) => {
            const campaignMeta = campaignStatusMeta(group.sessions)
            const continueSessionRecord = pickContinueSession(group.sessions)
            const expanded = expandedCampaigns.has(group.campaignId)
            const reportable = hasReportableInterview(group.sessions)
            return (
              <Collapsible
                key={group.campaignId}
                open={expanded}
                onOpenChange={(open) => {
                  setExpandedCampaigns((prev) => {
                    const next = new Set(prev)
                    if (open) next.add(group.campaignId)
                    else next.delete(group.campaignId)
                    return next
                  })
                }}
                className="rounded-xl border border-border bg-card"
              >
                <div className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="min-w-0 flex-1 rounded-lg text-left transition-colors hover:bg-muted/30"
                      >
                        <div className="flex items-start gap-2">
                          <Icon
                            icon={expanded ? "mdi:chevron-down" : "mdi:chevron-right"}
                            className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate text-base font-semibold">{group.title}</h3>
                              <Badge variant="outline" className="text-muted-foreground">
                                {playModeLabel(group.playMode)}
                              </Badge>
                              <Badge variant="outline" className={campaignMeta.className}>
                                {campaignMeta.label}
                              </Badge>
                              <Badge variant="secondary">
                                {group.distinctRoundCount} 轮 · {group.sessions.length} 条记录
                              </Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <Icon icon="mdi:file-document-outline" className="h-3.5 w-3.5" />
                                {group.resumeTitle}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <Icon icon="mdi:clock-outline" className="h-3.5 w-3.5" />
                                {formatDateTime(group.updatedAt)}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {Array.from(
                                group.sessions
                                  .reduce((map, session) => {
                                    const existing = map.get(session.roundId)
                                    if (
                                      !existing ||
                                      new Date(session.updatedAt).getTime() > new Date(existing.updatedAt).getTime()
                                    ) {
                                      map.set(session.roundId, session)
                                    }
                                    return map
                                  }, new Map<string, InterviewSessionRecord>())
                                  .values(),
                              )
                                .sort((a, b) => getRoundIndex(a.roundId) - getRoundIndex(b.roundId))
                                .map((session) => {
                                  const meta = statusMeta(session.status)
                                  return (
                                    <Badge key={session.roundId} variant="outline" className={`text-[11px] ${meta.className}`}>
                                      {session.roundLabel.split(" · ")[1] || session.roundLabel}
                                    </Badge>
                                  )
                                })}
                            </div>
                          </div>
                        </div>
                      </button>
                    </CollapsibleTrigger>

                    <div className="flex flex-wrap items-center gap-2">
                      {continueSessionRecord ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 bg-transparent"
                          onClick={() => continueSession(continueSessionRecord)}
                        >
                          <Icon icon="mdi:play-circle-outline" className="h-4 w-4" />
                          {continueSessionRecord.status === "in_progress" ? "继续当前轮" : "查看最近一轮"}
                        </Button>
                      ) : null}
                      {reportable ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 bg-transparent"
                          onClick={() => router.push(`/interviews/report/${group.campaignId}`)}
                        >
                          <Icon icon="mdi:file-chart-outline" className="h-4 w-4" />
                          报告
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <CollapsibleContent>
                  <div className="space-y-2 border-t bg-muted/10 px-4 py-3">
                    {group.sessions.map((session) => {
                      const meta = statusMeta(session.status)
                      const nextRound = getNextRound(session.roundId)
                      const duplicateCount = group.sessions.filter((item) => item.roundId === session.roundId).length
                      return (
                        <div
                          key={session.id}
                          className="rounded-lg border border-border/80 bg-card p-3 transition-colors hover:border-primary/30"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="secondary">{session.roundLabel}</Badge>
                                <Badge variant="outline" className={meta.className}>
                                  {meta.label}
                                </Badge>
                                {duplicateCount > 1 ? (
                                  <Badge variant="outline" className="text-[11px] text-muted-foreground">
                                    重复进入
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span className="inline-flex items-center gap-1">
                                  <Icon icon="mdi:clock-outline" className="h-3.5 w-3.5" />
                                  {formatDateTime(session.updatedAt)}
                                </span>
                                {session.questionCount ? (
                                  <span className="inline-flex items-center gap-1">
                                    <Icon icon="mdi:format-list-numbered" className="h-3.5 w-3.5" />
                                    已进行 {session.questionCount} 题
                                  </span>
                                ) : null}
                                {(session.failCount || 0) > 0 ? (
                                  <span className="inline-flex items-center gap-1 text-red-600">
                                    <Icon icon="mdi:close-circle-outline" className="h-3.5 w-3.5" />
                                    被关闭 {session.failCount} 次
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 bg-transparent"
                                onClick={() => continueSession(session)}
                              >
                                <Icon icon="mdi:play-circle-outline" className="h-4 w-4" />
                                {session.status === "terminated"
                                  ? "查看记录"
                                  : session.status === "completed"
                                    ? "查看"
                                    : "继续面试"}
                              </Button>
                              {nextRound ? (
                                <Button
                                  size="sm"
                                  className="brand-gradient-bg gap-1 border-0"
                                  onClick={() => void openHandoffDialog(session)}
                                >
                                  <Icon icon="mdi:arrow-right-circle-outline" className="h-4 w-4" />
                                  进入{nextRound.round}
                                </Button>
                              ) : null}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                title="删除该轮记录"
                                onClick={() => setDeleteTarget(session)}
                              >
                                <Icon icon="mdi:delete-outline" className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })
        )}
      </div>

      <CareerIntakeDialog
        open={intakeOpen}
        mode="interview"
        resumes={resumes}
        defaultResumeId={defaultResumeId ?? mostRecent?.id}
        onOpenChange={(open) => {
          setIntakeOpen(open)
          if (!open) refreshSessions()
        }}
      />

      <Dialog
        open={!!handoffParent}
        onOpenChange={(open) => {
          if (!open) {
            setHandoffParent(null)
            setHandoff(null)
            setHandoffError(null)
          }
        }}
      >
        <DialogContent className="flex max-h-[84vh] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>进入下一面前的交接评价</DialogTitle>
            <DialogDescription>
              选择上一轮会话，系统会生成一份给下一位面试官看的内部评价，并带入下一轮上下文。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">上一轮会话</div>
              <Select value={handoffSourceId} onValueChange={setHandoffSourceId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择会话 ID" />
                </SelectTrigger>
                <SelectContent>
                  {handoffSourceOptions.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title} · {formatDateTime(item.updatedAt)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg border bg-muted/20">
              <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">上一轮评价</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {selectedHandoffSource && handoffParent
                      ? `${handoffParent.roundLabel} · ${selectedHandoffSource.title}`
                      : "未选择会话"}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    title={handoffVisible ? "隐藏评价" : "查看评价"}
                    onClick={() => setHandoffVisible((value) => !value)}
                  >
                    <Icon icon={handoffVisible ? "mdi:eye-off-outline" : "mdi:eye-outline"} className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 bg-transparent"
                    disabled={handoffBusy || !selectedHandoffSource}
                    onClick={() => {
                      if (!selectedHandoffSource || !handoffParent) return
                      void deleteStoredRoundHandoff(handoffCacheKey(handoffParent.id, selectedHandoffSource.id))
                      setHandoff(null)
                      void generateSelectedHandoff(selectedHandoffSource, true)
                    }}
                  >
                    <Icon icon="mdi:refresh" className={`h-4 w-4 ${handoffBusy ? "agent-spin" : ""}`} />
                    重生成
                  </Button>
                </div>
              </div>
              <div className="relative min-h-[220px] p-4">
                {handoffBusy ? (
                  <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
                    <Icon icon="mdi:loading" className="agent-spin mr-2 h-4 w-4" />
                    正在生成上一轮评价…
                  </div>
                ) : handoffError ? (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {handoffError}
                  </div>
                ) : handoff ? (
                  <div className={handoffVisible ? "" : "select-none blur-sm"}>
                    <Markdown content={handoff.content} />
                  </div>
                ) : (
                  <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
                    暂无评价，点击重生成。
                  </div>
                )}
                {!handoffVisible && handoff && !handoffBusy ? (
                  <button
                    type="button"
                    className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/35 text-sm font-medium text-foreground backdrop-blur-[1px]"
                    onClick={() => setHandoffVisible(true)}
                  >
                    <span className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 shadow-sm">
                      <Icon icon="mdi:eye-outline" className="h-4 w-4" />
                      点击查看交接评价
                    </span>
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" className="bg-transparent" onClick={() => setHandoffParent(null)}>
              取消
            </Button>
            <Button
              className="brand-gradient-bg border-0"
              disabled={handoffBusy || !handoff}
              onClick={() => void startNextRoundWithHandoff()}
            >
              带入评价并进入下一面
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除该轮面试记录？</AlertDialogTitle>
            <AlertDialogDescription>
              将移除「{deleteTarget?.roundLabel}」的历史记录及对话进度，同一场模拟的其他轮次不受影响。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
