"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
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
import type { InterviewSessionRecord } from "@/types/interview-session"
import { getAllResumes, getCachedResumes } from "@/lib/storage"
import { composeInterviewBriefing, getInterviewRound, getNextRound } from "@/lib/agent/interview-rounds"
import {
  createNextRoundSession,
  deleteInterviewSession,
  deleteInterviewSessionStorage,
  listInterviewSessions,
  stashInterviewBriefing,
} from "@/lib/interview-sessions"
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

  const refreshSessions = useCallback(() => {
    setSessions(listInterviewSessions())
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
      .finally(() => {
        if (!cancelled) {
          refreshSessions()
          setLoading(false)
        }
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

  const visibleSessions = useMemo(() => {
    const needle = keyword.trim().toLowerCase()
    if (!needle) return sessions
    return sessions.filter(
      (item) =>
        item.title.toLowerCase().includes(needle) ||
        item.resumeTitle.toLowerCase().includes(needle) ||
        item.roundLabel.toLowerCase().includes(needle) ||
        (item.briefingPreview || "").toLowerCase().includes(needle),
    )
  }, [keyword, sessions])

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
    (session: InterviewSessionRecord, briefing: string) => {
      stashInterviewBriefing({
        resumeId: session.resumeId,
        sessionId: session.id,
        roundId: session.roundId,
        briefing,
        playMode: session.playMode,
      })
      router.push(`/career/interview/${session.resumeId}?session=${encodeURIComponent(session.id)}`)
    },
    [router],
  )

  const continueSession = useCallback(
    (session: InterviewSessionRecord) => {
      const round = getInterviewRound(session.roundId)!
      const briefing = composeInterviewBriefing(round, session.jobBriefing || session.briefingPreview || "")
      goToSession(session, briefing)
    },
    [goToSession],
  )

  const startNextRound = useCallback(
    (session: InterviewSessionRecord) => {
      const nextRound = getNextRound(session.roundId)
      if (!nextRound) {
        toast({ title: "已是最后一轮", description: "Leader 面是本次模拟面试的最后一轮。" })
        return
      }
      const nextSession = createNextRoundSession(session)
      if (!nextSession) {
        toast({
          title: "无法进入下一轮",
          description: "缺少岗位设定信息，请重新发起并完成 intake。",
          variant: "destructive",
        })
        return
      }
      const briefing = composeInterviewBriefing(nextRound, nextSession.jobBriefing || "")
      goToSession(nextSession, briefing)
      refreshSessions()
      toast({ title: "已进入下一轮", description: `${nextRound.label} 已就绪。` })
    },
    [goToSession, refreshSessions, toast],
  )

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return
    deleteInterviewSession(deleteTarget.id)
    deleteInterviewSessionStorage(deleteTarget.resumeId, deleteTarget.id)
    setDeleteTarget(null)
    refreshSessions()
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
          <Badge variant="secondary">{sessions.length} 场记录</Badge>
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
          { label: "历史场次", value: sessions.length, icon: "mdi:clipboard-text-outline", tint: "text-blue-600" },
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
        ) : visibleSessions.length === 0 ? (
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
          visibleSessions.map((session) => {
            const meta = statusMeta(session.status)
            const nextRound = getNextRound(session.roundId)
            return (
              <div
                key={session.id}
                className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/20"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold">{session.title}</h3>
                      <Badge variant="secondary">{session.roundLabel}</Badge>
                      <Badge variant="outline" className="text-muted-foreground">
                        {playModeLabel(session.playMode)}
                      </Badge>
                      <Badge variant="outline" className={meta.className}>
                        {meta.label}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Icon icon="mdi:file-document-outline" className="h-3.5 w-3.5" />
                        {session.resumeTitle}
                      </span>
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
                    {session.briefingPreview ? (
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {session.briefingPreview}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 bg-transparent"
                      onClick={() => continueSession(session)}
                    >
                      <Icon icon="mdi:play-circle-outline" className="h-4 w-4" />
                      {session.status === "terminated" ? "查看记录" : session.status === "completed" ? "查看" : "继续面试"}
                    </Button>
                    {nextRound ? (
                      <Button size="sm" className="brand-gradient-bg gap-1 border-0" onClick={() => startNextRound(session)}>
                        <Icon icon="mdi:arrow-right-circle-outline" className="h-4 w-4" />
                        进入{nextRound.round}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      title="删除记录"
                      onClick={() => setDeleteTarget(session)}
                    >
                      <Icon icon="mdi:delete-outline" className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
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

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这场模拟面试？</AlertDialogTitle>
            <AlertDialogDescription>
              将移除「{deleteTarget?.title}」的历史记录及本地对话进度，此操作不可撤销。
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
