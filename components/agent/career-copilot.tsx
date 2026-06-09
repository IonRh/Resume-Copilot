"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { streamChat } from "@/lib/agent/stream"
import { getAllApplications } from "@/lib/applications"
import { getResumeDisplayName } from "@/lib/resume-display"
import {
  COPILOT_ACTION_META,
  COPILOT_KICKOFF,
  COPILOT_TOOLS,
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

const QUICK_CHIPS: { label: string; send: string }[] = [
  { label: "从哪开始", send: "我该从哪开始？" },
  { label: "投递进度", send: "我的投递怎么样了？" },
  { label: "适合方向", send: "我适合投什么方向？" },
]

function actionPreview(action: CopilotAction, resumes: StoredResume[]) {
  const resume = action.resumeId ? resumes.find((item) => item.id === action.resumeId) : undefined
  const resumeTitle = resume ? getResumeDisplayName(resume) : undefined

  switch (action.kind) {
    case "create_resume":
      return {
        title: "创建新简历",
        destination: "简历创建",
        summary: "将跳转到创建页面，可选择空白模板、AI 辅助创建或图片导入。",
        details: ["不会修改已有简历", "选择创建方式后即可开始"],
        confirmLabel: "前往创建",
      }
    case "applications":
      return {
        title: "查看投递进度",
        destination: "投递看板",
        summary: "将打开投递看板，查看各投递的当前状态与待跟进事项。",
        details: ["仅查看，不会修改投递记录", "可快速梳理近期进度"],
        confirmLabel: "前往投递看板",
      }
    case "polish":
      return {
        title: "AI 润色简历",
        destination: "简历编辑",
        summary: "将打开所选简历，由 AI 分析表达并提出逐段修改建议。",
        details: [
          resumeTitle ? `目标简历：${resumeTitle}` : "使用助手推荐的简历",
          "仅提供建议，确认后才会应用修改",
        ],
        confirmLabel: "开始润色",
      }
    case "jd_match":
      return {
        title: "JD 匹配分析",
        destination: "JD 匹配",
        summary: "将引导你粘贴目标岗位 JD，并分析简历与岗位的匹配度及待优化项。",
        details: [
          resumeTitle ? `目标简历：${resumeTitle}` : "使用助手推荐的简历",
          "识别关键词匹配、能力缺口及建议改写部分",
        ],
        confirmLabel: "开始匹配",
      }
    case "discover":
      return {
        title: "岗位方向推荐",
        destination: "方向分析",
        summary: "将基于简历分析适合投递的岗位方向及待补充的能力项。",
        details: [
          resumeTitle ? `参考简历：${resumeTitle}` : "使用助手推荐的简历",
          "仅做分析，不会修改简历",
        ],
        confirmLabel: "开始分析",
      }
    case "interview":
      return {
        title: "模拟面试",
        destination: "模拟面试",
        summary: "将打开模拟面试页面，选择岗位和轮次后即可开始练习。",
        details: [
          resumeTitle ? `默认简历：${resumeTitle}` : "进入后可选择简历",
          "开始前需填写公司、岗位或 JD 信息",
        ],
        confirmLabel: "前往模拟面试",
      }
    case "edit_resume":
      return {
        title: "打开简历",
        destination: "简历编辑",
        summary: "将打开所选简历进行编辑；若为未完成草稿，将继续创建流程。",
        details: [
          resumeTitle ? `目标简历：${resumeTitle}` : "使用助手推荐的简历",
          "支持编辑、预览和导出",
        ],
        confirmLabel: "打开简历",
      }
  }
}

export default function CareerCopilot({ resumes, onAction }: CareerCopilotProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [streamText, setStreamText] = useState("")
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signals, setSignals] = useState<JobSearchSignals | null>(null)
  const [pendingAction, setPendingAction] = useState<CopilotAction | null>(null)

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
      while (!controller.signal.aborted) {
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

        // 模型偶尔只调工具、气泡为空，或把话误写进已废弃的 reason 字段——抽到气泡里
        let bubbleText = content?.trim() || ""
        if (!bubbleText) {
          for (const c of toolCalls.filter((t) => t.function.name === "suggest_actions")) {
            try {
              const raw = JSON.parse(c.function.arguments || "{}") as { actions?: Array<{ reason?: string; label?: string }> }
              for (const a of raw.actions || []) {
                if (typeof a.reason === "string" && a.reason.trim()) {
                  bubbleText = a.reason.trim()
                  break
                }
                if (!bubbleText && typeof a.label === "string" && a.label.trim().length > 10) {
                  bubbleText = a.label.trim()
                  break
                }
              }
              if (bubbleText) break
            } catch {
              /* ignore */
            }
          }
        }

        historyRef.current.push({
          role: "assistant",
          content: bubbleText || content || null,
          tool_calls: toolCalls.length ? toolCalls : undefined,
        })

        if (bubbleText || actions.length) {
          setMessages((m) => [
            ...m,
            { role: "assistant", content: bubbleText, actions: actions.length ? actions : undefined },
          ])
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

  const requestAction = (action: CopilotAction) => {
    setPendingAction(action)
  }

  const runAction = () => {
    if (!pendingAction) return
    const action = pendingAction
    setPendingAction(null)
    setOpen(false)
    onAction(action)
  }

  const pendingPreview = pendingAction ? actionPreview(pendingAction, resumes) : null

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={handleOpen}
          className="brand-icon-bg fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full border-0 transition-transform hover:-translate-y-0.5 hover:brightness-105"
          title="求职管家"
          aria-label="打开求职管家"
        >
          <Icon icon="mdi:robot-happy-outline" className="h-7 w-7" />
        </button>
      ) : null}

      {open ? (
        <div className="fixed inset-x-3 bottom-3 z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[400px] h-[72vh] max-h-[640px]">
          {/* 头部 */}
          <div className="flex items-center gap-2.5 border-b border-border p-3">
            <span className="brand-icon-bg grid h-9 w-9 shrink-0 place-items-center rounded-xl">
              <Icon icon="mdi:robot-happy-outline" className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-tight">求职管家</div>
              <div className="truncate text-xs text-muted-foreground">陪你看全局 · 一起定下一步</div>
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
                    <div className="flex flex-wrap gap-2">
                      {m.actions.map((action, j) => (
                        <button
                          key={j}
                          type="button"
                          onClick={() => requestAction(action)}
                          className="brand-gradient-bg inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
                        >
                          <Icon icon={COPILOT_ACTION_META[action.kind].icon} className="h-3.5 w-3.5" />
                          {action.label}
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
              {QUICK_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => send(chip.send)}
                  className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  {chip.label}
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
                placeholder="有什么卡住的，跟我说…"
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

      <Dialog open={Boolean(pendingAction)} onOpenChange={(next) => {
        if (!next) setPendingAction(null)
      }}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
          {pendingPreview ? (
            <>
              <DialogHeader>
                <div className="mb-1 flex items-center gap-2">
                  <span className="brand-icon-bg grid h-9 w-9 shrink-0 place-items-center rounded-xl">
                    <Icon
                      icon={pendingAction ? COPILOT_ACTION_META[pendingAction.kind].icon : "mdi:robot-happy-outline"}
                      className="h-5 w-5"
                    />
                  </span>
                  <div className="min-w-0">
                    <DialogTitle className="leading-tight">{pendingPreview.title}</DialogTitle>
                    <DialogDescription className="mt-1">
                      确认后将跳转到对应功能页面。
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-3">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Badge variant="secondary" className="rounded-full">
                      目标功能
                    </Badge>
                    <span className="text-sm font-medium">{pendingPreview.destination}</span>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">{pendingPreview.summary}</p>
                </div>

                <div className="space-y-2">
                  {pendingPreview.details.map((detail) => (
                    <div key={detail} className="flex items-start gap-2 text-sm">
                      <Icon icon="mdi:check-circle-outline" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="leading-5">{detail}</span>
                    </div>
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setPendingAction(null)}>
                  取消
                </Button>
                <Button className="brand-gradient-bg border-0" onClick={runAction}>
                  {pendingPreview.confirmLabel}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
