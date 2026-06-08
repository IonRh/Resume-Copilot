"use client"

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useResumeWorkspace, type WorkspaceContextValue } from "@/lib/agent/store"
import { useAgent } from "@/hooks/use-agent"
import { AGENT_PROFILES } from "@/lib/agent/prompts"
import type { AgentCard, AgentMode, AgentTurn, ChatContentPart, CoverLetterDraft } from "@/lib/agent/types"
import {
  DiffCard,
  DiscoverCard,
  InterviewCard,
  InterviewReportCard,
  JdCard,
  JdMatchPanel,
  ScoreCard,
  ToolStepView,
} from "./agent-cards"
import { Markdown } from "./markdown"

// 编辑器三分屏内仅保留贴合「编辑工作流」的模式；JD 匹配 / 模拟面试为各自专注页（lockedMode）。
// 评分诊断已移出 Agent，统一由顶部「体检」承担；此处只保留编辑类工作流模式。
const MODES: { key: AgentMode; label: string; icon: string }[] = [
  { key: "edit", label: "编辑", icon: "mdi:pencil-outline" },
  { key: "proofread", label: "校对纠错", icon: "mdi:spellcheck" },
  { key: "design", label: "排版美化", icon: "mdi:palette-outline" },
  { key: "quantify", label: "量化 & STAR", icon: "mdi:chart-timeline-variant" },
]

// 三分屏编辑器内可用的 Agent 模式（其余如 jd/interview 为独立专注页）。
const EDITOR_MODES = new Set<AgentMode>(["edit", "proofread", "design", "quantify"])

export interface AgentPanelHandle {
  send: (text: string, opts?: { displayText?: string; attachments?: ChatContentPart[] }) => void
}

const AgentPanel = forwardRef<AgentPanelHandle, {
  asOverlay?: boolean
  /** 专注页（JD / 面试）：锁定单一 Agent，隐藏模式切换与收起按钮 */
  lockedMode?: AgentMode
  hideSessionControls?: boolean
  workspace?: WorkspaceContextValue
  onUserSubmit?: (text: string) => void
  onUserTurnComplete?: (text: string) => void
  onNewSession?: (mode: AgentMode) => void
  onCoverLetter?: (draft: CoverLetterDraft) => void
}>(function AgentPanel({
  asOverlay = false,
  lockedMode,
  hideSessionControls = false,
  workspace,
  onUserSubmit,
  onUserTurnComplete,
  onNewSession,
  onCoverLetter,
}, ref) {
  const contextWorkspace = useResumeWorkspace()
  const ws = workspace ?? contextWorkspace
  const { send, retry, stop, rescore, running, rescoring, error } = useAgent(ws, { onCoverLetter })
  const [input, setInput] = useState("")
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [newSessionMode, setNewSessionMode] = useState<AgentMode>("edit")
  const [jdOpen, setJdOpen] = useState(false)
  const [mention, setMention] = useState<{ active: boolean; query: string; index: number }>({
    active: false,
    query: "",
    index: 0,
  })
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const kickoffSent = useRef(false)
  const lastAcceptedRef = useRef<number | null>(null)
  const rescoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const jdBtnRef = useRef<HTMLButtonElement | null>(null)
  const jdPopRef = useRef<HTMLDivElement | null>(null)
  const jdHistoryLenRef = useRef<number | null>(null)

  // 锁定模式（专注页）直接采用 lockedMode；编辑器内在 EDITOR_MODES 间切换，残留的 jd/interview 归一到 edit。
  const panelMode: AgentMode = lockedMode ?? (EDITOR_MODES.has(ws.mode) ? ws.mode : "edit")
  const profile = AGENT_PROFILES[panelMode]

  // 专注页：确保 store.mode 与锁定模式一致，使 system prompt 正确。
  useEffect(() => {
    if (lockedMode && ws.mode !== lockedMode) ws.setMode(lockedMode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedMode])

  // JD 模式：用户接受修改后，自动触发一次「重新评分」（防抖合并批量接受），让常驻面板分数实时演进。
  const acceptedCount = ws.staged.filter((s) => s.status === "accepted").length
  useEffect(() => {
    if (panelMode !== "jd") return
    // 首次（含刷新恢复历史）只记录基线，不触发评分
    if (lastAcceptedRef.current === null) {
      lastAcceptedRef.current = acceptedCount
      return
    }
    if (acceptedCount <= lastAcceptedRef.current) {
      lastAcceptedRef.current = acceptedCount
      return
    }
    lastAcceptedRef.current = acceptedCount
    // 尚无匹配卡片时（首轮卡片未出现）不打扰
    if (!ws.jdMatch) return
    if (rescoreTimerRef.current) clearTimeout(rescoreTimerRef.current)
    rescoreTimerRef.current = setTimeout(() => {
      rescoreTimerRef.current = null
      void rescore()
    }, 1500)
  }, [acceptedCount, panelMode, ws.jdMatch, rescore])

  // 卸载时清理待触发的重新评分定时器
  useEffect(() => () => {
    if (rescoreTimerRef.current) clearTimeout(rescoreTimerRef.current)
  }, [])

  // JD 匹配浮层：点击浮层与触发按钮以外区域时关闭
  useEffect(() => {
    if (!jdOpen) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (jdPopRef.current?.contains(target)) return
      if (jdBtnRef.current?.contains(target)) return
      setJdOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [jdOpen])

  // 离开 JD 模式或匹配数据清空时，关闭浮层
  useEffect(() => {
    if (panelMode !== "jd" || !ws.jdMatch) setJdOpen(false)
  }, [panelMode, ws.jdMatch])

  // 每生成一版新的匹配结果（首轮分析或重新评分）自动弹出一次浮层；刷新恢复历史不弹。
  const jdHistoryLen = ws.jdMatch?.history.length ?? 0
  useEffect(() => {
    if (panelMode !== "jd") return
    if (jdHistoryLenRef.current === null) {
      jdHistoryLenRef.current = jdHistoryLen
      return
    }
    if (jdHistoryLen > jdHistoryLenRef.current) setJdOpen(true)
    jdHistoryLenRef.current = jdHistoryLen
  }, [jdHistoryLen, panelMode])

  const modules = ws.resumeData.modules
  const mentionMatches = useMemo(() => {
    if (!mention.active) return []
    const q = mention.query.toLowerCase()
    return modules.filter((m) => !q || m.title.toLowerCase().includes(q)).slice(0, 6)
  }, [mention, modules])

  // 自动滚动到底部
  useEffect(() => {
    const el = messagesRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [ws.turns])

  // 主页入口注入的指令：自动发送一次后清空，避免重复触发。
  useEffect(() => {
    if (!ws.kickoff) {
      kickoffSent.current = false
      return
    }
    if (running || kickoffSent.current) return
    kickoffSent.current = true
    const prompt = ws.kickoff
    ws.setKickoff(null)
    // JD 模式：用一句人话替代暴露内部 present_jd_match 指令的气泡
    void send(prompt, panelMode === "jd" ? { displayText: "开始分析我与目标岗位的匹配度" } : undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.kickoff, running])

  const detectMention = (value: string, caret: number) => {
    const before = value.slice(0, caret)
    const at = before.lastIndexOf("@")
    if (at < 0) return setMention((m) => ({ ...m, active: false }))
    const between = before.slice(at + 1)
    if (/\s/.test(between)) return setMention((m) => ({ ...m, active: false }))
    setMention({ active: true, query: between, index: 0 })
  }

  const pickMention = (title: string, moduleId: string) => {
    const el = textareaRef.current
    const caret = el?.selectionStart ?? input.length
    const before = input.slice(0, caret)
    const at = before.lastIndexOf("@")
    const next = `${input.slice(0, at)}@${title} ${input.slice(caret)}`
    setInput(next)
    setMention({ active: false, query: "", index: 0 })
    const mod = modules.find((m) => m.id === moduleId)
    if (mod) {
      ws.setSelection({ kind: "module", id: moduleId, label: `模块「${mod.title}」` })
    }
    requestAnimationFrame(() => el?.focus())
  }

  const submit = (text?: string) => {
    const value = (text ?? input).trim()
    if (!value || running) return
    setInput("")
    setMention((m) => ({ ...m, active: false }))
    onUserSubmit?.(value)
    void send(value).then((sent) => {
      if (sent) onUserTurnComplete?.(value)
    })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.active && mentionMatches.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setMention((m) => ({ ...m, index: (m.index + 1) % mentionMatches.length }))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setMention((m) => ({ ...m, index: (m.index - 1 + mentionMatches.length) % mentionMatches.length }))
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        const pick = mentionMatches[mention.index]
        if (pick) pickMention(pick.title, pick.id)
        return
      }
      if (e.key === "Escape") {
        setMention((m) => ({ ...m, active: false }))
        return
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const createSession = () => {
    ws.newSession(newSessionMode)
    onNewSession?.(newSessionMode)
    setNewSessionOpen(false)
  }

  useImperativeHandle(ref, () => ({
    send: (text, opts) => {
      void send(text, { displayText: opts?.displayText, attachments: opts?.attachments })
    },
  }), [send])

  return (
    <aside
      className={`rw-agent ${asOverlay ? "is-mobile-overlay" : ""} ${lockedMode ? "is-half" : ""}`}
    >
      <div className="agent-panel">
        {!hideSessionControls ? (
          <div className="agent-session-bar relative">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent text-xs">
                  <Icon icon="mdi:history" className="h-3.5 w-3.5" />
                  历史记录
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Agent 会话</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {ws.sessions.map((session) => (
                  <DropdownMenuItem
                    key={session.id}
                    className="flex items-center justify-between gap-2"
                    onClick={() => ws.switchSession(session.id)}
                  >
                    <span className="min-w-0 truncate">{session.title}</span>
                    {session.id === ws.activeSessionId ? (
                      <Icon icon="mdi:check" className="h-3.5 w-3.5 text-primary" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {panelMode === "jd" && ws.jdMatch ? (
              <button
                ref={jdBtnRef}
                className="jd-trigger"
                data-open={jdOpen ? "1" : undefined}
                onClick={() => setJdOpen((o) => !o)}
                title="查看 JD 匹配分析"
              >
                <Icon icon="mdi:target" className="h-3.5 w-3.5 text-primary" />
                <span>JD 匹配</span>
                <span className="jd-trigger-score">{ws.jdMatch.current.matchScore}</span>
                <Icon
                  icon="mdi:chevron-down"
                  className={`h-3.5 w-3.5 transition-transform ${jdOpen ? "rotate-180" : ""}`}
                />
              </button>
            ) : null}

            {panelMode === "jd" && ws.jdMatch && jdOpen ? (
              <div ref={jdPopRef} className="jd-pop">
                <JdMatchPanel
                  onApply={(p) => submit(p)}
                  onRescore={rescore}
                  rescoring={rescoring}
                  onClose={() => setJdOpen(false)}
                />
              </div>
            ) : null}

            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 bg-transparent text-xs"
              onClick={() => {
                if (lockedMode) {
                  ws.newSession(lockedMode)
                  onNewSession?.(lockedMode)
                } else {
                  setNewSessionMode("edit")
                  setNewSessionOpen(true)
                }
              }}
            >
              <Icon icon="mdi:plus" className="h-3.5 w-3.5" />
              新建
            </Button>

            {!lockedMode ? (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-8 w-8 p-0"
                onClick={() => ws.setAgentOpen(false)}
                title="收起助手"
              >
                <Icon icon="mdi:close" className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* 消息区 */}
        <div ref={messagesRef} className="agent-messages">
          {ws.turns.length === 0 ? (
            <div className="agent-empty">
              <span className="brand-gradient-bg mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl">
                <Icon icon={lockedMode ? profile.icon : "mdi:sparkles"} className="h-6 w-6" />
              </span>
              <p className="text-sm font-medium text-foreground">
                {lockedMode ? profile.name : "让 AI 帮你打磨简历"}
              </p>
              <p className="mt-1 text-xs">
                {lockedMode ? profile.tagline : "描述需求，或点选预览中的元素后再提问。"}
              </p>
              <div className="mt-4 flex flex-col gap-1.5">
                {profile.suggestions.map((s) => (
                  <button
                    key={s}
                    className="rounded-lg border border-border px-3 py-1.5 text-left text-xs hover:border-primary hover:text-foreground"
                    onClick={() => submit(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            ws.turns.map((turn) => (
              <TurnView
                key={turn.id}
                turn={turn}
                onApply={(p) => submit(p)}
                onRetry={running ? undefined : retry}
                hideJdCards={panelMode === "jd"}
              />
            ))
          )}

          {error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        {/* 待确认条 */}
        {ws.pendingCount > 0 ? (
          <div className="agent-pending-bar">
            <span className="flex items-center gap-1.5 font-medium">
              <Icon icon="mdi:clipboard-check-outline" className="h-4 w-4 text-primary" />
              {ws.pendingCount} 项修改待确认
            </span>
            <span className="flex gap-2">
              <Button size="sm" className="brand-gradient-bg h-6 gap-1 border-0 text-xs" onClick={() => ws.acceptAll()}>
                全部接受
              </Button>
              <Button size="sm" variant="outline" className="h-6 gap-1 bg-transparent text-xs" onClick={() => ws.rejectAll()}>
                全部拒绝
              </Button>
            </span>
          </div>
        ) : null}

        {/* 输入区 */}
        <div className="agent-composer">
          {ws.selection ? (
            <div className="agent-selection-chip">
              <Icon icon="mdi:cursor-default-click-outline" className="h-3 w-3" />
              {ws.selection.label}
              <button className="ml-1" onClick={() => ws.clearSelection()} title="取消选中">
                <Icon icon="mdi:close" className="h-3 w-3" />
              </button>
            </div>
          ) : null}

          <div className="agent-composer-box relative">
            {mention.active && mentionMatches.length ? (
              <div className="mention-menu absolute bottom-full left-0 z-30 mb-1 w-full">
                {mentionMatches.map((m, i) => (
                  <div
                    key={m.id}
                    className="mention-item"
                    data-active={i === mention.index}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      pickMention(m.title, m.id)
                    }}
                  >
                    <Icon icon="mdi:view-module-outline" className="h-3.5 w-3.5 text-muted-foreground" />
                    {m.title}
                  </div>
                ))}
              </div>
            ) : null}

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length)
              }}
              onKeyDown={onKeyDown}
              placeholder={
                lockedMode === "interview"
                  ? "输入你的回答，面试官会继续追问"
                  : lockedMode === "coverLetter"
                    ? "告诉我目标岗位、公司或粘贴 JD"
                  : lockedMode === "build"
                    ? ""
                    : "描述你的需求，如「润色工作经历」（@ 引用模块）"
              }
              rows={2}
              className="max-h-32 w-full resize-none bg-transparent text-sm outline-none"
            />
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-muted-foreground">Enter 发送 · Shift+Enter 换行</span>
              {running ? (
                <Button size="sm" variant="outline" className="h-7 gap-1 bg-transparent text-xs" onClick={stop}>
                  <Icon icon="mdi:stop" className="h-3.5 w-3.5" /> 停止
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="brand-gradient-bg h-7 gap-1 border-0 text-xs"
                  disabled={!input.trim()}
                  onClick={() => submit()}
                >
                  <Icon icon="mdi:send" className="h-3.5 w-3.5" /> 发送
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={newSessionOpen} onOpenChange={setNewSessionOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建 Agent 会话</DialogTitle>
            <DialogDescription>选择这次会话要使用的工作模式。</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2">
            {MODES.map((m) => (
              <button
                key={m.key}
                className="agent-new-session-option"
                data-active={newSessionMode === m.key}
                onClick={() => setNewSessionMode(m.key)}
              >
                <Icon icon={m.icon} className="h-5 w-5" />
                <span className="font-medium">{m.label}</span>
              </button>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNewSessionOpen(false)}>
              取消
            </Button>
            <Button className="brand-gradient-bg border-0" onClick={createSession}>
              新建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
})

export default AgentPanel

function TurnView({
  turn,
  onApply,
  onRetry,
  hideJdCards = false,
}: {
  turn: AgentTurn
  onApply: (prompt: string) => void
  onRetry?: () => void
  /** JD 专注页：常驻面板已展示匹配卡片，聊天流里的 jd 卡片应隐藏避免重复 */
  hideJdCards?: boolean
}) {
  if (turn.role === "user") {
    return (
      <div className="flex flex-col items-end">
        {turn.selectionLabel ? (
          <span className="agent-selection-chip">
            <Icon icon="mdi:cursor-default-click-outline" className="h-3 w-3" />
            {turn.selectionLabel}
          </span>
        ) : null}
        <div className="agent-bubble agent-bubble-user">{turn.content}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {turn.parts?.length ? (
        turn.parts.map((part, index) => {
          if (part.type === "text") {
            return (
              <AssistantText
                key={part.id}
                content={part.content}
                streaming={Boolean(turn.streaming && index === turn.parts!.length - 1)}
              />
            )
          }
          if (part.type === "step") {
            const step = turn.steps?.find((s) => s.id === part.stepId)
            return step ? <ToolStepView key={part.id} step={step} /> : null
          }
          if (part.type === "change") return <DiffCard key={part.id} changeId={part.changeId} />
          if (part.type === "card") {
            const card = turn.cards?.[part.cardIndex]
            if (!card) return null
            if (hideJdCards && card.type === "jd") return null
            return <AgentCardView key={part.id} card={card} onApply={onApply} />
          }
          return null
        })
      ) : (
        <>
          {turn.content ? (
            <AssistantText content={turn.content} streaming={Boolean(turn.streaming)} />
          ) : turn.streaming && !turn.steps?.length ? (
            <div className="agent-bubble agent-bubble-assistant text-muted-foreground">
              <Icon icon="mdi:loading" className="agent-spin mr-1 inline h-3.5 w-3.5" /> 思考中…
            </div>
          ) : null}

          {turn.steps?.length ? (
            <div className="flex flex-col gap-1">
              {turn.steps.map((s) => (
                <ToolStepView key={s.id} step={s} />
              ))}
            </div>
          ) : null}

          {turn.changeIds?.length ? (
            <div className="flex flex-col gap-2">
              {turn.changeIds.map((id) => (
                <DiffCard key={id} changeId={id} />
              ))}
            </div>
          ) : null}

          {turn.cards?.length
            ? turn.cards
                .filter((card) => !(hideJdCards && card.type === "jd"))
                .map((card, i) => <AgentCardView key={i} card={card} onApply={onApply} />)
            : null}
        </>
      )}

      {turn.error && onRetry ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-fit gap-1 bg-transparent text-xs"
          onClick={onRetry}
        >
          <Icon icon="mdi:refresh" className="h-3.5 w-3.5" /> 重试
        </Button>
      ) : null}
    </div>
  )
}

function AssistantText({ content, streaming }: { content: string; streaming: boolean }) {
  return (
    <div className="agent-bubble agent-bubble-assistant">
      <Markdown content={content} />
      {streaming ? <span className="ml-0.5 inline-block animate-pulse">▋</span> : null}
    </div>
  )
}

function AgentCardView({ card, onApply }: { card: AgentCard; onApply: (prompt: string) => void }) {
  if (card.type === "score") return <ScoreCard card={card} />
  if (card.type === "discover") return <DiscoverCard card={card} />
  if (card.type === "jd") return <JdCard card={card} onApply={onApply} />
  if (card.type === "interview") return <InterviewCard card={card} />
  if (card.type === "interview_report") return <InterviewReportCard card={card} />
  return null
}
