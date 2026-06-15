"use client"

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useResumeWorkspace, type WorkspaceContextValue } from "@/lib/agent/store"
import { useAgent } from "@/hooks/use-agent"
import { AGENT_PROFILES } from "@/lib/agent/prompts"
import {
  buildAnalysisFeedItems,
  getFollowUpThread,
  type AnalysisFeedItem,
} from "@/lib/interview-analysis-summary"
import { Markdown } from "./markdown"
import type { AgentPanelHandle } from "./agent-panel"

const profile = AGENT_PROFILES.interviewAnalysis

const InterviewAnalysisPanel = forwardRef<
  AgentPanelHandle,
  {
    workspace?: WorkspaceContextValue
    onRunningChange?: (running: boolean) => void
  }
>(function InterviewAnalysisPanel({ workspace, onRunningChange }, ref) {
  const contextWorkspace = useResumeWorkspace()
  const ws = workspace ?? contextWorkspace
  const { send, running, error } = useAgent(ws)
  const [selected, setSelected] = useState<AnalysisFeedItem | null>(null)
  const [followUp, setFollowUp] = useState("")
  const [followUpSending, setFollowUpSending] = useState(false)
  const feedRef = useRef<HTMLDivElement | null>(null)

  const feedItems = useMemo(() => buildAnalysisFeedItems(ws.turns), [ws.turns])

  const selectedThread = useMemo(() => {
    if (!selected) return []
    return getFollowUpThread(ws.turns, selected.turnId)
  }, [selected, ws.turns])

  const selectedLive = useMemo(() => {
    if (!selected) return null
    return feedItems.find((item) => item.turnId === selected.turnId) ?? selected
  }, [feedItems, selected])

  useEffect(() => {
    onRunningChange?.(running)
  }, [onRunningChange, running])

  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [feedItems.length, running])

  useEffect(() => {
    if (!selected?.turnId) return
    const updated = feedItems.find((item) => item.turnId === selected.turnId)
    if (updated) setSelected(updated)
  }, [feedItems, selected?.turnId])

  useImperativeHandle(
    ref,
    () => ({
      send: (text, opts) => {
        void send(text, { displayText: opts?.displayText, attachments: opts?.attachments })
      },
    }),
    [send],
  )

  const submitFollowUp = async () => {
    const question = followUp.trim()
    if (!question || !selectedLive || running || followUpSending) return

    const prompt = [
      "请针对以下这轮模拟面试分析回答我的追问。你是旁路分析教练，不要继续出正式面试题。",
      "",
      `【第 ${selectedLive.round} 轮分析原文】`,
      selectedLive.content || "（暂无内容）",
      "",
      "【我的追问】",
      question,
    ].join("\n")

    setFollowUp("")
    setFollowUpSending(true)
    try {
      await send(prompt, { displayText: `追问：${question}` })
    } finally {
      setFollowUpSending(false)
    }
  }

  const onFollowUpKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void submitFollowUp()
    }
  }

  return (
    <>
      <aside className="rw-agent is-half">
        <div className="agent-panel">
          <div className="analysis-feed-head">
            <Icon icon={profile.icon} className="h-4 w-4 text-primary" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">{profile.name}</div>
              <div className="truncate text-[11px] text-muted-foreground">{profile.tagline}</div>
            </div>
          </div>

          <div ref={feedRef} className="analysis-feed">
            {feedItems.length === 0 && !running ? (
              <div className="agent-empty">
                <span className="brand-gradient-bg mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl">
                  <Icon icon={profile.icon} className="h-6 w-6" />
                </span>
                <p className="text-sm font-medium text-foreground">面试表现会在这里汇总</p>
                <p className="mt-1 text-xs">每答完一题，左侧会出现一张分析卡片，点击查看详细评价并可追问。</p>
              </div>
            ) : (
              <div className="analysis-feed-stack">
                {feedItems.map((item) => (
                  <AnalysisFeedCard
                    key={item.turnId}
                    item={item}
                    active={selected?.turnId === item.turnId}
                    onOpen={() => setSelected(item)}
                  />
                ))}
              </div>
            )}

            {error ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {error}
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="analysis-detail-dialog flex max-h-[min(88vh,820px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          {selectedLive ? (
            <>
              <DialogHeader className="shrink-0 border-b border-border px-5 py-4 text-left">
                <DialogTitle className="flex items-center gap-2 text-base">
                  <Icon icon="mdi:clipboard-text-search-outline" className="h-5 w-5 text-primary" />
                  {selectedLive.title}
                  {selectedLive.score ? (
                    <span className="analysis-feed-score ml-1">{selectedLive.score}</span>
                  ) : null}
                </DialogTitle>
                <DialogDescription className="text-left">{selectedLive.preview}</DialogDescription>
              </DialogHeader>

              <div className="analysis-detail-body min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {selectedLive.streaming && !selectedLive.content ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Icon icon="mdi:loading" className="agent-spin h-4 w-4" />
                    正在生成评价…
                  </div>
                ) : (
                  <div className="analysis-detail-markdown">
                    <Markdown content={selectedLive.content || "（暂无内容）"} />
                  </div>
                )}

                {selectedThread.length ? (
                  <div className="mt-5 space-y-3 border-t border-border pt-4">
                    <div className="text-xs font-semibold text-muted-foreground">追问记录</div>
                    {selectedThread.map((turn) =>
                      turn.role === "user" ? (
                        <div key={turn.id} className="analysis-followup-user">
                          {turn.content.replace(/^追问：/, "")}
                        </div>
                      ) : (
                        <div key={turn.id} className="analysis-detail-markdown rounded-lg border border-border bg-card p-3">
                          {turn.streaming && !turn.content ? (
                            <span className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Icon icon="mdi:loading" className="agent-spin h-3.5 w-3.5" /> 回复中…
                            </span>
                          ) : (
                            <Markdown content={turn.content || "（暂无回复）"} />
                          )}
                        </div>
                      ),
                    )}
                  </div>
                ) : null}
              </div>

              <div className="analysis-detail-composer shrink-0 border-t border-border px-5 py-4">
                <label className="mb-2 block text-xs font-medium text-muted-foreground">继续追问</label>
                <div className="analysis-detail-input-box">
                  <textarea
                    value={followUp}
                    onChange={(e) => setFollowUp(e.target.value)}
                    onKeyDown={onFollowUpKeyDown}
                    placeholder="例如：这段回答怎么改得更简洁？"
                    rows={2}
                    disabled={selectedLive.streaming || running || followUpSending}
                    className="max-h-28 w-full resize-none bg-transparent text-sm outline-none"
                  />
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-muted-foreground">Enter 发送 · Shift+Enter 换行</span>
                    <Button
                      size="sm"
                      className="brand-gradient-bg h-7 gap-1 border-0 text-xs"
                      disabled={
                        !followUp.trim() ||
                        selectedLive.streaming ||
                        running ||
                        followUpSending
                      }
                      onClick={() => void submitFollowUp()}
                    >
                      {followUpSending || (running && followUp.trim()) ? (
                        <Icon icon="mdi:loading" className="agent-spin h-3.5 w-3.5" />
                      ) : (
                        <Icon icon="mdi:comment-question-outline" className="h-3.5 w-3.5" />
                      )}
                      追问
                    </Button>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
})

export default InterviewAnalysisPanel

function AnalysisFeedCard({
  item,
  active,
  onOpen,
}: {
  item: AnalysisFeedItem
  active: boolean
  onOpen: () => void
}) {
  const loading = item.streaming

  return (
    <button
      type="button"
      className="analysis-feed-card"
      data-active={active ? "1" : undefined}
      data-loading={loading ? "1" : undefined}
      onClick={onOpen}
    >
      <div className="analysis-feed-card-top">
        <span className="analysis-feed-card-round">{item.title}</span>
        {item.score ? <span className="analysis-feed-score">{item.score}</span> : null}
        {loading ? (
          <Icon icon="mdi:loading" className="agent-spin ml-auto h-3.5 w-3.5 text-primary" />
        ) : (
          <Icon icon="mdi:chevron-right" className="ml-auto h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <p className="analysis-feed-card-preview">
        {loading ? "正在分析本轮回答，完成后可查看详细评价…" : item.preview}
      </p>
      {item.error ? (
        <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-destructive">
          <Icon icon="mdi:alert-circle-outline" className="h-3.5 w-3.5" />
          分析未完成，点击查看详情
        </span>
      ) : null}
    </button>
  )
}
