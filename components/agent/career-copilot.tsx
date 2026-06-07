"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import { streamChat } from "@/lib/agent/stream"
import { getAllApplications } from "@/lib/applications"
import {
  COPILOT_ACTION_META,
  COPILOT_KICKOFF,
  COPILOT_TOOLS,
  attentionCount,
  buildCopilotContext,
  buildCopilotSystemPrompt,
  buildFallbackBriefing,
  normalizeActions,
  type CopilotAction,
  type JobSearchSignals,
} from "@/lib/agent/copilot"
import type { ChatMessage } from "@/lib/agent/types"
import type { JobApplication } from "@/types/application"
import type { StoredResume } from "@/types/resume"
import { Markdown } from "./markdown"

interface CareerCopilotProps {
  /** 主页当前的简历列表（由 user-center 传入，避免重复拉取） */
  resumes: StoredResume[]
  /** 行动按钮点击回调：由 user-center 映射到现有 handler */
  onAction: (action: CopilotAction) => void
}

interface Msg {
  role: "assistant" | "user"
  content: string
  actions?: CopilotAction[]
}

const QUICK_PROMPTS = ["我该从哪开始？", "我的投递怎么样了？", "我适合投什么方向？"]
const MAX_ITERATIONS = 3

export default function CareerCopilot({ resumes, onAction }: CareerCopilotProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [streamText, setStreamText] = useState("")
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signals, setSignals] = useState<JobSearchSignals | null>(null)

  const applicationsRef = useRef<JobApplication[]>([])
  const systemRef = useRef<string>("")
  const historyRef = useRef<ChatMessage[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const kickedOffRef = useRef(false)

  // 预取投递并算出红点数（不依赖打开面板）
  useEffect(() => {
    let cancelled = false
    void getAllApplications()
      .then((apps) => {
        if (cancelled) return
        applicationsRef.current = apps
        setSignals(buildCopilotContext(resumes, apps).signals)
      })
      .catch(() => {
        if (!cancelled) setSignals(buildCopilotContext(resumes, []).signals)
      })
    return () => {
      cancelled = true
    }
  }, [resumes])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streamText, busy])

  // 运行一轮对话循环：history 已包含本轮（可能隐藏的）用户指令
  const run = useCallback(async () => {
    setError(null)
    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller

    try {
      let iteration = 0
      while (iteration < MAX_ITERATIONS) {
        iteration += 1
        if (controller.signal.aborted) break

        setStreamText("")
        const { content, toolCalls } = await streamChat(
          [{ role: "system", content: systemRef.current }, ...historyRef.current.slice(-20)],
          { tools: COPILOT_TOOLS, toolChoice: "auto" },
          controller.signal,
          (delta) => setStreamText((p) => p + delta),
        )
        setStreamText("")

        const actions = toolCalls
          .filter((c) => c.function.name === "suggest_actions")
          .flatMap((c) => {
            try {
              return normalizeActions((JSON.parse(c.function.arguments || "{}") as { actions?: unknown }).actions)
            } catch {
              return []
            }
          })

        historyRef.current.push({
          role: "assistant",
          content: content || null,
          tool_calls: toolCalls.length ? toolCalls : undefined,
        })

        if (content || actions.length) {
          setMessages((m) => [...m, { role: "assistant", content: content || "", actions: actions.length ? actions : undefined }])
        }

        if (!toolCalls.length) break

        // 回执每个工具调用，让模型可收尾
        for (const call of toolCalls) {
          historyRef.current.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            content: "已为用户展示行动入口按钮。",
          })
        }
        // 已经给出按钮则结束，避免重复推荐
        if (actions.length) break
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        // 兜底：用确定性现状播报 + 推荐，保证无 LLM 也可用
        const sig = signals ?? buildCopilotContext(resumes, applicationsRef.current).signals
        const fallback = buildFallbackBriefing(sig)
        setMessages((m) => [...m, { role: "assistant", content: fallback.text, actions: fallback.actions }])
      }
      setStreamText("")
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }, [resumes, signals])

  // 首次打开：拉取最新投递、注入现状并自动播报
  const ensureKickoff = useCallback(() => {
    if (kickedOffRef.current) return
    kickedOffRef.current = true
    setBusy(true)
    void (async () => {
      let apps = applicationsRef.current
      try {
        apps = await getAllApplications()
        applicationsRef.current = apps
      } catch {
        /* 拉取失败则用预取/空数据兜底 */
      }
      const ctx = buildCopilotContext(resumes, apps)
      setSignals(ctx.signals)
      systemRef.current = buildCopilotSystemPrompt(ctx.summary)
      historyRef.current = [{ role: "user", content: COPILOT_KICKOFF }]
      await run()
    })()
  }, [resumes, run])

  const handleOpen = useCallback(() => {
    setOpen(true)
    ensureKickoff()
  }, [ensureKickoff])

  const handleClose = useCallback(() => {
    abortRef.current?.abort()
    setOpen(false)
  }, [])

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (!text || busy) return
      setInput("")
      setMessages((m) => [...m, { role: "user", content: text }])
      historyRef.current.push({ role: "user", content: text })
      void run()
    },
    [busy, run],
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setStreamText("")
    setError(null)
    historyRef.current = []
    kickedOffRef.current = false
    ensureKickoff()
  }, [ensureKickoff])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const runAction = (action: CopilotAction) => {
    setOpen(false)
    onAction(action)
  }

  const badge = signals ? attentionCount(signals) : 0

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={handleOpen}
          className="brand-gradient-bg fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full border-0 shadow-lg transition-transform hover:-translate-y-0.5 hover:shadow-xl"
          title="求职管家"
          aria-label="打开求职管家"
        >
          <Icon icon="mdi:robot-happy-outline" className="h-7 w-7" />
          {badge > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </button>
      ) : null}

      {open ? (
        <div className="fixed inset-x-3 bottom-3 z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[400px] h-[72vh] max-h-[640px]">
          {/* 头部 */}
          <div className="flex items-center gap-2.5 border-b border-border p-3">
            <span className="brand-gradient-bg grid h-9 w-9 shrink-0 place-items-center rounded-xl">
              <Icon icon="mdi:robot-happy-outline" className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-tight">求职管家</div>
              <div className="truncate text-xs text-muted-foreground">懂你全局 · 帮你定下一步</div>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={reset} disabled={busy} title="重新开始">
              <Icon icon="mdi:refresh" className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose} title="收起">
              <Icon icon="mdi:chevron-down" className="h-4 w-4" />
            </Button>
          </div>

          {/* 对话区 */}
          <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto bg-muted/20 p-3">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="agent-bubble agent-bubble-user">{m.content}</div>
                </div>
              ) : (
                <div key={i} className="flex flex-col gap-2">
                  {m.content ? (
                    <div className="agent-bubble agent-bubble-assistant">
                      <Markdown content={m.content} />
                    </div>
                  ) : null}
                  {m.actions?.length ? (
                    <div className="flex flex-col gap-1.5">
                      {m.actions.map((action, j) => (
                        <button
                          key={j}
                          type="button"
                          onClick={() => runAction(action)}
                          className="group flex items-center gap-2.5 rounded-xl border border-border bg-card p-2.5 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
                        >
                          <span className="brand-gradient-bg grid h-8 w-8 shrink-0 place-items-center rounded-lg">
                            <Icon icon={COPILOT_ACTION_META[action.kind].icon} className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{action.label}</span>
                            {action.reason ? (
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">{action.reason}</span>
                            ) : null}
                          </span>
                          <Icon
                            icon="mdi:arrow-right"
                            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                          />
                        </button>
                      ))}
                    </div>
                  ) : null}
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

          {/* 快捷问题 */}
          {!busy ? (
            <div className="flex flex-wrap gap-1.5 border-t border-border px-3 pt-2.5">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  {q}
                </button>
              ))}
            </div>
          ) : null}

          {/* 输入区 */}
          <div className="p-3 pt-2">
            <div className="agent-composer-box">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="问问我接下来该做什么…"
                rows={2}
                disabled={busy}
                className="max-h-28 w-full resize-none bg-transparent text-sm outline-none disabled:opacity-60"
              />
              <div className="flex items-center justify-end pt-1">
                <Button
                  size="sm"
                  className="brand-gradient-bg h-7 gap-1 border-0 text-xs"
                  disabled={!input.trim() || busy}
                  onClick={() => send(input)}
                >
                  <Icon icon="mdi:send" className="h-3.5 w-3.5" /> 发送
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
