"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { runAiCheckup, type AiCheckupIssue, type AiCheckupReport } from "@/lib/agent/checkup"
import { useResumeWorkspace } from "@/lib/agent/store"

const AUTO_INTERVAL_MS = 60_000

function formatCountdown(ms: number): string {
  if (ms <= 0) return "即将开始"
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`
}

function priorityLabel(priority: AiCheckupIssue["priority"]): string {
  if (priority === "high") return "优先"
  if (priority === "medium") return "建议"
  return "可选"
}

function priorityClass(priority: AiCheckupIssue["priority"]): string {
  if (priority === "high") return "border-rose-200 bg-rose-50 text-rose-700"
  if (priority === "medium") return "border-amber-200 bg-amber-50 text-amber-700"
  return "border-slate-200 bg-slate-50 text-slate-600"
}

export default function CheckupAssistant() {
  const ws = useResumeWorkspace()
  const [report, setReport] = useState<AiCheckupReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [nextRunAt, setNextRunAt] = useState<number>(() => Date.now() + AUTO_INTERVAL_MS)
  const [tick, setTick] = useState(() => Date.now())
  const [bubbleDismissed, setBubbleDismissed] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const checkingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const resumeVersion = ws.resumeData.updatedAt

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const startCheckup = useCallback(async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    setChecking(true)
    setError(null)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const next = await runAiCheckup(ws.resumeRef.current, controller.signal)
      setReport(next)
      setBubbleDismissed(false)
      setNextRunAt(Date.now() + AUTO_INTERVAL_MS)
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : String(err))
        setBubbleDismissed(false)
        setNextRunAt(Date.now() + AUTO_INTERVAL_MS)
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      checkingRef.current = false
      setChecking(false)
    }
  }, [ws.resumeRef])

  useEffect(() => {
    if (ws.agentOpen) return
    setNextRunAt(Date.now() + AUTO_INTERVAL_MS)
  }, [resumeVersion, ws.agentOpen])

  useEffect(() => {
    if (ws.agentOpen || checkingRef.current) return
    const delay = Math.max(0, nextRunAt - Date.now())
    const timer = window.setTimeout(() => {
      void startCheckup()
    }, delay)
    return () => window.clearTimeout(timer)
  }, [nextRunAt, startCheckup, ws.agentOpen])

  useEffect(() => () => abortRef.current?.abort(), [])

  const countdown = Math.max(0, nextRunAt - tick)
  const highCount = report?.issues.filter((issue) => issue.priority === "high").length ?? 0
  const buttonTitle = checking
    ? "AI 正在体检这份简历"
    : ws.agentOpen
      ? "AI 侧边栏开启时暂停自动体检"
      : `下次自动体检还有 ${formatCountdown(countdown)}`

  const bubbleTitle = useMemo(() => {
    if (error) return "AI 体检失败"
    if (checking) return "AI 正在体检"
    if (!report) return ""
    if (report.issues.length === 0) return "AI 体检未发现明显问题"
    return `AI 体检发现 ${report.issues.length} 个优化点`
  }, [checking, error, report])

  const runIssueWithAgent = (issue: AiCheckupIssue) => {
    const prompt = [
      "请根据这条 AI 简历体检建议处理我的简历。请先读取简历结构，必要时询问我补充事实；不要编造经历或数字；修改以待确认 diff 的形式给出。",
      "",
      `【问题】${issue.title}`,
      `【类别】${issue.category}`,
      `【优先级】${priorityLabel(issue.priority)}`,
      issue.evidence ? `【证据】${issue.evidence}` : "",
      `【建议】${issue.suggestion}`,
      "",
      "【执行指令】",
      issue.prompt,
    ].filter(Boolean).join("\n")
    ws.newSession("edit")
    ws.setMode("edit")
    ws.setAgentOpen(true)
    ws.setKickoff(prompt)
    setDialogOpen(false)
    setBubbleDismissed(true)
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="gap-2 bg-transparent"
        onClick={() => void startCheckup()}
        title={buttonTitle}
        disabled={checking}
      >
        <Icon icon={checking ? "mdi:loading" : "mdi:stethoscope"} className={`h-4 w-4 ${checking ? "agent-spin" : ""}`} />
        <span className="hidden sm:inline">体检</span>
        {!checking && report?.issues.length ? (
          <span className="grid h-4 min-w-4 place-items-center rounded-full bg-amber-100 px-1 text-[10px] font-bold text-amber-700">
            {report.issues.length}
          </span>
        ) : null}
      </Button>

      {(report || error || checking) && !bubbleDismissed && !dialogOpen ? (
        <div className="fixed bottom-5 right-5 z-40 w-[min(360px,calc(100vw-2rem))] rounded-xl border bg-background p-4 shadow-xl">
          <div className="flex items-start gap-3">
            <span className="brand-gradient-bg grid h-9 w-9 shrink-0 place-items-center rounded-lg">
              <Icon icon={checking ? "mdi:loading" : error ? "mdi:alert-circle-outline" : "mdi:stethoscope"} className={`h-5 w-5 ${checking ? "agent-spin" : ""}`} />
            </span>
            <button className="min-w-0 flex-1 text-left" onClick={() => report && setDialogOpen(true)}>
              <div className="text-sm font-semibold">{bubbleTitle}</div>
              <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                {error || report?.summary || "正在分析内容完整性、岗位表达、量化成果与样式一致性..."}
              </p>
              {report?.issues.length ? (
                <div className="mt-2 text-xs text-muted-foreground">
                  {highCount ? `${highCount} 项建议优先处理 · ` : ""}点击查看完整建议
                </div>
              ) : null}
            </button>
            <button className="text-muted-foreground hover:text-foreground" onClick={() => setBubbleDismissed(true)} title="关闭">
              <Icon icon="mdi:close" className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[86vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon icon="mdi:stethoscope" className="h-5 w-5 text-primary" />
              AI 简历体检建议
            </DialogTitle>
            <DialogDescription>
              {report?.overallScore !== undefined ? `综合评分 ${Math.round(report.overallScore)} / 100。` : ""}
              {report?.summary}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[62vh] space-y-3 overflow-y-auto pr-1">
            {report?.issues.length ? report.issues.map((issue) => (
              <div key={issue.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${priorityClass(issue.priority)}`}>
                        {priorityLabel(issue.priority)}
                      </span>
                      <span className="text-xs text-muted-foreground">{issue.category}</span>
                    </div>
                    <h3 className="mt-1 text-sm font-semibold">{issue.title}</h3>
                  </div>
                  <Button size="sm" className="brand-gradient-bg h-7 gap-1 border-0 text-xs" onClick={() => runIssueWithAgent(issue)}>
                    <Icon icon="mdi:auto-fix" className="h-3.5 w-3.5" />
                    让 AI 执行
                  </Button>
                </div>
                <p className="mt-2 text-sm leading-relaxed">{issue.summary}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{issue.detail}</p>
                {issue.evidence ? (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">证据：{issue.evidence}</p>
                ) : null}
                <p className="mt-2 rounded-md bg-muted/60 p-2 text-xs leading-relaxed">
                  建议：{issue.suggestion}
                </p>
              </div>
            )) : (
              <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
                暂未发现明显问题。
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
