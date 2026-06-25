"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ChatMessage } from "@/lib/agent/types"
import type { StoredResume } from "@/types/resume"
import type { InterviewPlayMode } from "@/types/interview-session"
import { Markdown } from "./markdown"
import { AGENT_PROFILES, INTAKE_TOOL } from "@/lib/agent/prompts"
import { buildResumeOutline } from "@/lib/agent/changeset"
import { streamChat } from "@/lib/agent/stream"
import { INTERVIEW_INTAKE_TOOL_SCHEMAS } from "@/lib/agent/tool-schemas"
import { getResumeById } from "@/lib/storage"
import { getResumeDisplayName } from "@/lib/resume-display"
import { extractInterviewTitle, upsertInterviewSession } from "@/lib/interview-sessions"
import {
  composeInterviewBriefing,
  DEFAULT_INTERVIEW_ROUND_ID,
  extractJobBriefing,
  getInterviewRound,
  INTERVIEW_ROUNDS,
  interviewRoundIntakeNote,
  type InterviewRoundId,
} from "@/lib/agent/interview-rounds"

const STREAM_FLUSH_MS = 80

type IntakeMode = "jd" | "interview"

interface Msg {
  role: "assistant" | "user" | "tool"
  content: string
  status?: "running" | "done" | "error"
}

interface CareerIntakeDialogProps {
  open: boolean
  mode: IntakeMode
  resumes: StoredResume[]
  defaultResumeId?: string
  defaultRoundId?: InterviewRoundId
  onOpenChange: (open: boolean) => void
}

/** 非面试专注页的跳转 briefing；模拟面试记录统一走 SQLite。 */
export const CAREER_BRIEFING_KEY = "career-briefing"

export default function CareerIntakeDialog({
  open,
  mode,
  resumes,
  defaultResumeId,
  defaultRoundId,
  onOpenChange,
}: CareerIntakeDialogProps) {
  const router = useRouter()
  const profile = AGENT_PROFILES[mode]
  const intake = profile.intake!

  const [selectedId, setSelectedId] = useState<string | undefined>(defaultResumeId)
  const [selectedRoundId, setSelectedRoundId] = useState<InterviewRoundId>(DEFAULT_INTERVIEW_ROUND_ID)
  const [playMode, setPlayMode] = useState<InterviewPlayMode>("practice")
  const [messages, setMessages] = useState<Msg[]>([])
  const [streamText, setStreamText] = useState("")
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const historyRef = useRef<ChatMessage[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const researchResultRef = useRef("")
  const streamBufferRef = useRef("")
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 面试研究 gate 只拦截一次，避免死循环；用户随后可正常进入
  const finishGateUsedRef = useRef(false)

  const flushStreamText = () => {
    if (!streamBufferRef.current) return
    const chunk = streamBufferRef.current
    streamBufferRef.current = ""
    setStreamText((prev) => prev + chunk)
  }

  const queueStreamText = (delta: string) => {
    if (!delta) return
    streamBufferRef.current += delta
    if (streamTimerRef.current) return
    streamTimerRef.current = window.setTimeout(() => {
      streamTimerRef.current = null
      flushStreamText()
    }, STREAM_FLUSH_MS)
  }

  const resetStreamText = () => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current)
      streamTimerRef.current = null
    }
    streamBufferRef.current = ""
    setStreamText("")
  }

  // 打开时初始化对话；关闭时中止流
  useEffect(() => {
    if (open) {
      setMessages([{ role: "assistant", content: intake.greeting }])
      historyRef.current = [{ role: "assistant", content: intake.greeting }]
      resetStreamText()
      setInput("")
      setError(null)
      setBusy(false)
      setSelectedId(defaultResumeId ?? resumes[0]?.id)
      setSelectedRoundId(defaultRoundId ?? DEFAULT_INTERVIEW_ROUND_ID)
      setPlayMode("practice")
      researchResultRef.current = ""
      finishGateUsedRef.current = false
    } else {
      abortRef.current?.abort()
      resetStreamText()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, defaultRoundId])

  useEffect(
    () => () => {
      if (streamTimerRef.current) clearTimeout(streamTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streamText])

  const finalize = async (briefing: string) => {
    const id = selectedId ?? resumes[0]?.id
    if (!id) return
    const sessionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const resume = resumes.find((item) => item.id === id)
    const now = new Date().toISOString()
    const campaignId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    if (mode === "interview") {
      const jobBriefing = extractJobBriefing(briefing)
      await upsertInterviewSession({
        id: sessionId,
        campaignId,
        resumeId: id,
        resumeTitle: getResumeDisplayName(resume),
        title: extractInterviewTitle(briefing),
        roundLabel: selectedRound.label,
        roundId: selectedRoundId,
        jobBriefing,
        briefingPreview: briefing.slice(0, 300),
        playMode,
        status: "in_progress",
        createdAt: now,
        updatedAt: now,
      })
    }
    if (mode !== "interview") {
      try {
        sessionStorage.setItem(
          CAREER_BRIEFING_KEY,
          JSON.stringify({ mode, resumeId: id, briefing, sessionId, roundId: selectedRoundId, playMode }),
        )
      } catch {
        /* 退化：无 briefing 也能进入 */
      }
    }
    onOpenChange(false)
    router.push(mode === "interview" ? `/career/${mode}/${id}?session=${encodeURIComponent(sessionId)}` : `/career/${mode}/${id}`)
  }

  const briefingFromHistory = () =>
    historyRef.current
      .filter((m) => m.role === "user" && typeof m.content === "string")
      .map((m) => m.content as string)
      .join("\n\n")
      .trim()

  const selectedRound = getInterviewRound(selectedRoundId) ?? INTERVIEW_ROUNDS[0]

  const buildBriefing = () => {
    const history = briefingFromHistory()
    if (mode !== "interview") return history
    return composeInterviewBriefing(selectedRound, history)
  }

  const buildSystemPrompt = (outline: string) => {
    const base = intake.system(outline)
    if (mode !== "interview") return base
    return [base, "", interviewRoundIntakeNote(selectedRound)].join("\n")
  }

  const intakeTools = mode === "interview" ? [INTAKE_TOOL, ...INTERVIEW_INTAKE_TOOL_SCHEMAS] : [INTAKE_TOOL]

  const runResearch = async (args: Record<string, unknown>): Promise<string> => {
    setMessages((m) => [
      ...m,
      { role: "tool", content: "深入研究公司中", status: "running" },
    ])
    // 研究只针对「公司 + 岗位」本身，刻意不传简历，避免研究因简历而偏向某些方向、忽略其它。
    const res = await fetch("/api/agent/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        company: typeof args.company === "string" ? args.company : "",
        role: typeof args.role === "string" ? args.role : "",
        jd: typeof args.jd === "string" && args.jd.trim() ? args.jd : briefingFromHistory(),
      }),
    })
    const payload = (await res.json().catch(() => ({}))) as { research?: string; error?: string; detail?: string }
    const message = payload.research || payload.error || payload.detail || `研究服务返回 ${res.status}`
    setMessages((m) =>
      m.map((item, index) =>
        index === m.findIndex((candidate) => candidate.role === "tool" && candidate.status === "running")
          ? { ...item, content: res.ok ? "公司与岗位研究完成" : message, status: res.ok ? "done" : "error" }
          : item,
      ),
    )
    if (!res.ok) return `研究失败：${message}\n\n请明确询问用户：是否重试研究，还是直接开始模拟面试。`
    researchResultRef.current = message
    return message
  }

  const enoughAction = () => {
    void finalize(buildBriefing())
  }

  const send = async (raw: string) => {
    const text = raw.trim()
    if (!text || busy) return
    const id = selectedId ?? resumes[0]?.id
    if (!id) {
      setError("请先选择一份简历")
      return
    }

    setInput("")
    setError(null)
    setBusy(true)
    setMessages((m) => [...m, { role: "user", content: text }])
    historyRef.current.push({ role: "user", content: text })

    const entry = await getResumeById(id)
    const outline = entry ? buildResumeOutline(entry.resumeData) : "（暂无法读取简历结构）"
    const system: ChatMessage = { role: "system", content: buildSystemPrompt(outline) }

    const controller = new AbortController()
    abortRef.current = controller

    try {
      resetStreamText()
      for (let i = 0; i < 4; i++) {
        const { content, toolCalls } = await streamChat(
          [system, ...historyRef.current.slice(-20)],
          { tools: intakeTools, toolChoice: "auto" },
          controller.signal,
          queueStreamText,
        )

        const research = toolCalls.find((c) => c.function.name === "research_company_interview")
        historyRef.current.push({
          role: "assistant",
          content: content || null,
          tool_calls: research ? [research] : toolCalls.length ? toolCalls : undefined,
        })
        if (content) setMessages((m) => [...m, { role: "assistant", content }])
        resetStreamText()

        if (research) {
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(research.function.arguments || "{}") as Record<string, unknown>
          } catch {
            args = {}
          }
          const result = await runResearch(args)
          historyRef.current.push({
            role: "tool",
            tool_call_id: research.id,
            name: research.function.name,
            content: result.slice(0, 6000),
          })
          continue
        }

        const finish = toolCalls.find((c) => c.function.name === "finish_intake")
        if (finish) {
          // 面试在进入前必须先做一次公司/岗位研究（仅拦一次，避免死循环）。
          // JD 不拦：它只负责收集，详细分析交给工作台，避免抢活。
          if (mode === "interview" && !researchResultRef.current && !finishGateUsedRef.current) {
            finishGateUsedRef.current = true
            historyRef.current.push({
              role: "tool",
              tool_call_id: finish.id,
              name: finish.function.name,
              content:
                "（系统拦截）现在还不能进入面试台。用户已给出公司/岗位，请先调用 research_company_interview 做公司与岗位研究，并用一条消息呈现研究要点；若用户明确要求跳过研究或直接开始，则可以再次调用 finish_intake。",
            })
            continue
          }

          let briefing = ""
          try {
            briefing = (JSON.parse(finish.function.arguments || "{}") as { briefing?: string }).briefing ?? ""
          } catch {
            briefing = ""
          }
          const result = researchResultRef.current
          void finalize(
            mode === "interview" && result && !(briefing || "").includes(result.slice(0, 80))
              ? [briefing || buildBriefing(), "", "【公司与岗位研究】", result].filter(Boolean).join("\n")
              : briefing || buildBriefing(),
          )
        }
        break
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : String(err))
      }
      resetStreamText()
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void send(input)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex h-[82vh] max-h-[660px] w-full max-w-xl flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        {/* 头部 + 简历选择 */}
        <div className="border-b border-border p-4">
          <div className="flex items-center gap-2.5">
            <span className="brand-gradient-bg grid h-9 w-9 place-items-center rounded-xl">
              <Icon icon={profile.icon} className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold leading-tight">{intake.title}</DialogTitle>
              <DialogDescription className="truncate text-xs text-muted-foreground">
                {intake.description}
              </DialogDescription>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">使用简历</span>
            <Select value={selectedId} onValueChange={setSelectedId} disabled={busy}>
              <SelectTrigger className="h-9 flex-1">
                <SelectValue placeholder="选择一份简历" />
              </SelectTrigger>
              <SelectContent>
                {resumes.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {getResumeDisplayName(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {mode === "interview" ? (
            <>
              <div className="mt-2 flex items-center gap-2">
                <span className="shrink-0 text-xs text-muted-foreground">面试轮次</span>
                <Select value={selectedRoundId} onValueChange={(value) => setSelectedRoundId(value as InterviewRoundId)} disabled={busy}>
                  <SelectTrigger className="h-9 flex-1">
                    <SelectValue placeholder="选择面试轮次" />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERVIEW_ROUNDS.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="shrink-0 text-xs text-muted-foreground">面试模式</span>
                <Select value={playMode} onValueChange={(value) => setPlayMode(value as InterviewPlayMode)} disabled={busy}>
                  <SelectTrigger className="h-9 flex-1">
                    <SelectValue placeholder="选择模式" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="practice">学习练手</SelectItem>
                    <SelectItem value="simulation">真实模拟</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}
        </div>

        {/* 对话区 */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-muted/20 p-4">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="agent-bubble agent-bubble-user">{m.content}</div>
              </div>
            ) : m.role === "tool" ? (
              <div key={i} className="tool-step" data-status={m.status || "running"}>
                {m.status === "running" ? (
                  <Icon icon="mdi:loading" className="agent-spin h-3.5 w-3.5" />
                ) : m.status === "error" ? (
                  <span className="tool-step-dot" style={{ background: "#ef4444" }} />
                ) : (
                  <span className="tool-step-dot" />
                )}
                <span>{m.content}</span>
              </div>
            ) : (
              <div key={i} className="agent-bubble agent-bubble-assistant">
                <Markdown content={m.content} />
              </div>
            ),
          )}
          {busy ? (
            <div className="agent-bubble agent-bubble-assistant">
              {streamText ? (
                <Markdown content={streamText} />
              ) : (
                <span className="text-muted-foreground">
                  <Icon icon="mdi:loading" className="agent-spin mr-1 inline h-3.5 w-3.5" /> 思考中…
                </span>
              )}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        {/* 输入区 */}
        <div className="border-t border-border p-3">
          <div className="agent-composer-box">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={intake.placeholder}
              rows={2}
              disabled={busy}
              className="max-h-28 w-full resize-none bg-transparent text-sm outline-none disabled:opacity-60"
            />
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                onClick={enoughAction}
                disabled={busy || briefingFromHistory().length === 0}
                title="跳过追问，直接进入工作台"
              >
                信息够了，直接进入
              </button>
              <Button
                size="sm"
                className="brand-gradient-bg h-7 gap-1 border-0 text-xs"
                disabled={!input.trim() || busy}
                onClick={() => void send(input)}
              >
                <Icon icon="mdi:send" className="h-3.5 w-3.5" /> 发送
              </Button>
            </div>
          </div>
          <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
            信息收齐后我会自动带你进入「左简历 · 右助手」工作台。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
