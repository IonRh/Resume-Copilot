"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import { useResumeWorkspace } from "@/lib/agent/store"
import { useAgent } from "@/hooks/use-agent"
import { AGENT_PROFILES } from "@/lib/agent/prompts"
import type { AgentMode, AgentTurn } from "@/lib/agent/types"
import { DiffCard, InterviewCard, JdCard, ScoreCard, ToolStepView } from "./agent-cards"
import { Markdown } from "./markdown"

// 编辑器三分屏内仅保留贴合「编辑工作流」的模式；JD 匹配 / 模拟面试为各自专注页（lockedMode）。
const MODES: { key: AgentMode; label: string; icon: string }[] = [
  { key: "edit", label: "编辑", icon: "mdi:pencil-outline" },
  { key: "score", label: "评分诊断", icon: "mdi:chart-box-outline" },
]

export default function AgentPanel({
  asOverlay = false,
  lockedMode,
}: {
  asOverlay?: boolean
  /** 专注页（JD / 面试）：锁定单一 Agent，隐藏模式切换与收起按钮 */
  lockedMode?: AgentMode
}) {
  const ws = useResumeWorkspace()
  const { send, stop, running, error } = useAgent()
  const [input, setInput] = useState("")
  const [mention, setMention] = useState<{ active: boolean; query: string; index: number }>({
    active: false,
    query: "",
    index: 0,
  })
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const kickoffSent = useRef(false)

  // 锁定模式（专注页）直接采用 lockedMode；编辑器内只在 edit / score 间切换，残留的 jd/interview 归一到 edit。
  const panelMode: AgentMode = lockedMode ?? (ws.mode === "score" ? "score" : "edit")
  const profile = AGENT_PROFILES[panelMode]

  // 专注页：确保 store.mode 与锁定模式一致，使 system prompt 正确。
  useEffect(() => {
    if (lockedMode && ws.mode !== lockedMode) ws.setMode(lockedMode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedMode])

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
    void send(prompt)
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
    void send(value)
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

  return (
    <aside
      className={`rw-agent ${asOverlay ? "is-mobile-overlay" : ""} ${lockedMode ? "is-half" : ""}`}
    >
      <div className="agent-panel">
        {/* 头部 */}
        <div className="agent-header">
          <div className="flex items-center gap-2">
            <span className="brand-gradient-bg grid h-7 w-7 place-items-center rounded-lg">
              <Icon icon={lockedMode ? profile.icon : "mdi:robot-happy-outline"} className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold leading-none">
                {lockedMode ? profile.name : "AI 简历助手"}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {lockedMode ? profile.tagline : "可接管并修改所有元素"}
              </div>
            </div>
          </div>
          {!lockedMode ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => ws.setAgentOpen(false)}
              title="收起助手"
            >
              <Icon icon="mdi:close" className="h-4 w-4" />
            </Button>
          ) : null}
        </div>

        {/* 模式切换（专注页隐藏） */}
        {!lockedMode ? (
          <div className="agent-modes">
            {MODES.map((m) => (
              <button
                key={m.key}
                className="agent-mode-chip"
                data-active={panelMode === m.key}
                onClick={() => ws.setMode(m.key)}
              >
                <span className="inline-flex items-center gap-1">
                  <Icon icon={m.icon} className="h-3 w-3" />
                  {m.label}
                </span>
              </button>
            ))}
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
            ws.turns.map((turn) => <TurnView key={turn.id} turn={turn} onApply={(p) => submit(p)} />)
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
              placeholder="描述你的需求，如「润色工作经历」（@ 引用模块）"
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
    </aside>
  )
}

function TurnView({ turn, onApply }: { turn: AgentTurn; onApply: (prompt: string) => void }) {
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
      {turn.content ? (
        <div className="agent-bubble agent-bubble-assistant">
          <Markdown content={turn.content} />
          {turn.streaming ? <span className="ml-0.5 inline-block animate-pulse">▋</span> : null}
        </div>
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
        ? turn.cards.map((card, i) => {
            if (card.type === "score") return <ScoreCard key={i} card={card} />
            if (card.type === "jd") return <JdCard key={i} card={card} onApply={onApply} />
            if (card.type === "interview") return <InterviewCard key={i} card={card} />
            return null
          })
        : null}
    </div>
  )
}
