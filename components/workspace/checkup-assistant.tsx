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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { runAiCheckup, type AiCheckupIssue, type AiCheckupReport } from "@/lib/agent/checkup"
import { useResumeWorkspace } from "@/lib/agent/store"

const AUTO_INTERVAL_MS = 60_000
const CHECKUP_HISTORY_LIMIT = 8
const CHECKUP_STORAGE_VERSION = 1

interface CheckupHistoryEntry {
  id: string
  report: AiCheckupReport
  resumeVersion: string
  source: "auto" | "manual"
}

interface PersistedCheckupState {
  version: number
  history: CheckupHistoryEntry[]
}

function checkupStorageKey(storageKey: string): string {
  return `${storageKey}.checkup-history`
}

function normalizeHistoryEntry(raw: unknown): CheckupHistoryEntry | null {
  if (!raw || typeof raw !== "object") return null
  const entry = raw as Partial<CheckupHistoryEntry>
  if (typeof entry.id !== "string") return null
  if (typeof entry.resumeVersion !== "string") return null
  if (entry.source !== "auto" && entry.source !== "manual") return null
  const report = entry.report as Partial<AiCheckupReport> | undefined
  if (!report || typeof report.summary !== "string" || typeof report.generatedAt !== "string") return null
  return {
    id: entry.id,
    resumeVersion: entry.resumeVersion,
    source: entry.source,
    report: {
      summary: report.summary,
      overallScore: typeof report.overallScore === "number" ? report.overallScore : undefined,
      dimensions: Array.isArray(report.dimensions) ? report.dimensions : [],
      strengths: Array.isArray(report.strengths) ? report.strengths.map(String) : [],
      generatedAt: report.generatedAt,
      issues: Array.isArray(report.issues) ? report.issues : [],
    },
  }
}

function loadPersistedHistory(storageKey: string): CheckupHistoryEntry[] {
  const raw = window.localStorage.getItem(checkupStorageKey(storageKey))
  if (!raw) return []
  const parsed = JSON.parse(raw) as PersistedCheckupState | CheckupHistoryEntry[]
  const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.history) ? parsed.history : []
  return items.map(normalizeHistoryEntry).filter((entry): entry is CheckupHistoryEntry => Boolean(entry)).slice(0, CHECKUP_HISTORY_LIMIT)
}

function savePersistedHistory(storageKey: string, history: CheckupHistoryEntry[]): void {
  if (!history.length) {
    window.localStorage.removeItem(checkupStorageKey(storageKey))
    return
  }
  const payload: PersistedCheckupState = {
    version: CHECKUP_STORAGE_VERSION,
    history: history.slice(0, CHECKUP_HISTORY_LIMIT),
  }
  window.localStorage.setItem(checkupStorageKey(storageKey), JSON.stringify(payload))
}

function createHistoryEntry(
  report: AiCheckupReport,
  resumeVersion: string,
  source: CheckupHistoryEntry["source"],
): CheckupHistoryEntry {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return { id, report, resumeVersion, source }
}

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

function scoreVerdict(score: number): string {
  if (score >= 90) return "优秀"
  if (score >= 80) return "良好"
  if (score >= 70) return "尚可"
  if (score >= 60) return "待提升"
  return "需重写"
}

function sourceLabel(source: CheckupHistoryEntry["source"]): string {
  return source === "manual" ? "手动体检" : "自动体检"
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function historyLabel(entry: CheckupHistoryEntry): string {
  const score = typeof entry.report.overallScore === "number" ? `${Math.round(entry.report.overallScore)} 分` : null
  const issuePart = entry.report.issues.length ? `${entry.report.issues.length} 个优化点` : "无明显问题"
  return [sourceLabel(entry.source), formatGeneratedAt(entry.report.generatedAt), score || issuePart].join(" · ")
}

export default function CheckupAssistant() {
  const ws = useResumeWorkspace()
  const [history, setHistory] = useState<CheckupHistoryEntry[]>([])
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [nextRunAt, setNextRunAt] = useState<number>(() => Date.now() + AUTO_INTERVAL_MS)
  const [tick, setTick] = useState(() => Date.now())
  const [bubbleDismissed, setBubbleDismissed] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const checkingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const historyHydratedKeyRef = useRef<string | null>(null)
  const resumeVersion = ws.resumeData.updatedAt
  const latestEntry = history[0] ?? null
  const selectedEntry = useMemo(
    () => history.find((entry) => entry.id === selectedReportId) || latestEntry || null,
    [history, latestEntry, selectedReportId],
  )
  const latestReport = latestEntry?.report ?? null
  const report = selectedEntry?.report ?? null

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    historyHydratedKeyRef.current = null
    try {
      const persisted = loadPersistedHistory(ws.storageKey)
      setHistory(persisted)
      setSelectedReportId((current) => current || persisted[0]?.id || null)
    } catch {
      setHistory([])
      setSelectedReportId(null)
    } finally {
      historyHydratedKeyRef.current = ws.storageKey
    }
  }, [ws.storageKey])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (historyHydratedKeyRef.current !== ws.storageKey) return
    try {
      savePersistedHistory(ws.storageKey, history)
    } catch {
      /* localStorage 不可用时忽略，页面仍可正常使用 */
    }
  }, [history, ws.storageKey])

  const startCheckup = useCallback(async (source: CheckupHistoryEntry["source"] = "manual") => {
    if (checkingRef.current) return
    checkingRef.current = true
    setChecking(true)
    setError(null)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const next = await runAiCheckup(ws.resumeRef.current, controller.signal)
      const entry = createHistoryEntry(next, ws.resumeRef.current.updatedAt, source)
      setHistory((prev) => [entry, ...prev].slice(0, CHECKUP_HISTORY_LIMIT))
      setSelectedReportId((current) => {
        if (dialogOpen && current) return current
        return entry.id
      })
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
  }, [dialogOpen, ws.resumeRef])

  useEffect(() => {
    if (ws.agentOpen) return
    setNextRunAt(Date.now() + AUTO_INTERVAL_MS)
  }, [resumeVersion, ws.agentOpen])

  useEffect(() => {
    if (ws.agentOpen || checkingRef.current) return
    const delay = Math.max(0, nextRunAt - Date.now())
    const timer = window.setTimeout(() => {
      void startCheckup("auto")
    }, delay)
    return () => window.clearTimeout(timer)
  }, [nextRunAt, startCheckup, ws.agentOpen])

  useEffect(() => () => abortRef.current?.abort(), [])

  const countdown = Math.max(0, nextRunAt - tick)
  const highCount = latestReport?.issues.filter((issue) => issue.priority === "high").length ?? 0
  const buttonTitle = checking
    ? "AI 正在体检这份简历"
    : ws.agentOpen
      ? "AI 侧边栏开启时暂停自动体检"
      : `下次自动体检还有 ${formatCountdown(countdown)}`

  const latestHasScore = typeof latestReport?.overallScore === "number"
  const currentHasScore = typeof report?.overallScore === "number"
  const bubbleTitle = useMemo(() => {
    if (error) return "AI 体检失败"
    if (checking) return "AI 正在体检"
    if (!latestReport) return ""
    const scorePart = typeof latestReport.overallScore === "number" ? `${Math.round(latestReport.overallScore)} 分` : ""
    if (latestReport.issues.length === 0) return scorePart ? `AI 体检 ${scorePart} · 未发现明显问题` : "AI 体检未发现明显问题"
    return scorePart
      ? `AI 体检 ${scorePart} · ${latestReport.issues.length} 个优化点`
      : `AI 体检发现 ${latestReport.issues.length} 个优化点`
  }, [checking, error, latestReport])

  const openLatestDialog = () => {
    if (latestEntry) setSelectedReportId(latestEntry.id)
    setDialogOpen(true)
  }

  const viewingHistoricalReport = Boolean(selectedEntry && latestEntry && selectedEntry.id !== latestEntry.id)
  const staleReport = Boolean(selectedEntry && selectedEntry.resumeVersion !== resumeVersion)

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
        onClick={() => {
          if (latestEntry || error) {
            openLatestDialog()
            return
          }
          void startCheckup("manual")
        }}
        title={buttonTitle}
        disabled={checking}
      >
        <Icon icon={checking ? "mdi:loading" : "mdi:stethoscope"} className={`h-4 w-4 ${checking ? "agent-spin" : ""}`} />
        <span className="hidden sm:inline">体检</span>
        {!checking && latestHasScore ? (
          <span className="grid h-4 min-w-5 place-items-center rounded-full bg-primary/10 px-1 text-[10px] font-bold text-primary">
            {Math.round(latestReport!.overallScore!)}
          </span>
        ) : !checking && latestReport?.issues.length ? (
          <span className="grid h-4 min-w-4 place-items-center rounded-full bg-amber-100 px-1 text-[10px] font-bold text-amber-700">
            {latestReport.issues.length}
          </span>
        ) : null}
      </Button>

      {(latestReport || error || checking) && !bubbleDismissed && !dialogOpen ? (
        <div className="fixed bottom-5 right-5 z-40 w-[min(360px,calc(100vw-2rem))] rounded-xl border bg-background p-4 shadow-xl">
          <div className="flex items-start gap-3">
            <span className="brand-gradient-bg grid h-9 w-9 shrink-0 place-items-center rounded-lg">
              <Icon icon={checking ? "mdi:loading" : error ? "mdi:alert-circle-outline" : "mdi:stethoscope"} className={`h-5 w-5 ${checking ? "agent-spin" : ""}`} />
            </span>
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                if (latestEntry || error) openLatestDialog()
              }}
            >
              <div className="text-sm font-semibold">{bubbleTitle}</div>
              <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                {error || latestReport?.summary || "正在分析内容完整性、岗位表达、量化成果与样式一致性..."}
              </p>
              {latestReport?.issues.length ? (
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
              AI 简历体检报告
            </DialogTitle>
            <DialogDescription>{report?.summary || error || "查看最近一次 AI 体检结果。"}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2 border-b pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              {history.length > 1 ? (
                <Select value={selectedEntry?.id} onValueChange={setSelectedReportId}>
                  <SelectTrigger className="h-9 w-full sm:max-w-md">
                    <SelectValue placeholder="选择体检记录" />
                  </SelectTrigger>
                  <SelectContent>
                    {history.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {historyLabel(entry)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : latestEntry ? (
                <div className="text-xs text-muted-foreground">最近一次：{historyLabel(latestEntry)}</div>
              ) : null}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5 bg-transparent"
              onClick={() => void startCheckup("manual")}
              disabled={checking}
            >
              <Icon icon={checking ? "mdi:loading" : "mdi:refresh"} className={`h-4 w-4 ${checking ? "agent-spin" : ""}`} />
              重新体检
            </Button>
          </div>

          <div className="max-h-[62vh] space-y-3 overflow-y-auto pr-1">
            {selectedEntry && (viewingHistoricalReport || staleReport) ? (
              <div className="rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                {viewingHistoricalReport ? `你正在查看历史体检：${historyLabel(selectedEntry)}。` : `当前展示的是 ${historyLabel(selectedEntry)}。`}
                {staleReport ? " 这份报告基于较早的简历版本，便于回看之前的优化提示。" : ""}
              </div>
            ) : null}

            {!report && error ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            {currentHasScore ? (
              <div className="rounded-xl border bg-muted/30 p-4">
                <div className="flex items-center gap-4">
                  <div className="score-ring" style={{ ["--val" as string]: String(Math.round(report!.overallScore!)) }}>
                    {Math.round(report!.overallScore!)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">
                      综合得分 {Math.round(report!.overallScore!)} / 100 · {scoreVerdict(report!.overallScore!)}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">站在 HR 视角的整体诊断，分数随简历改进而提升。</p>
                  </div>
                </div>

                {report?.dimensions.length ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {report.dimensions.map((d) => (
                      <div key={d.name}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium">{d.name}</span>
                          <span className="text-muted-foreground">{d.score}</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="brand-gradient-bg h-full rounded-full"
                            style={{ width: `${Math.max(0, Math.min(100, d.score))}%` }}
                          />
                        </div>
                        {d.comment ? <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{d.comment}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                {report?.strengths.length ? (
                  <div className="mt-3">
                    <div className="mb-1 text-xs font-semibold">简历亮点</div>
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                      {report.strengths.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {report?.issues.length ? (
              <div className="px-0.5 pt-1 text-xs font-semibold text-muted-foreground">
                优化项（{report.issues.length}）
              </div>
            ) : null}
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
