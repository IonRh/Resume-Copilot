"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useResumeWorkspace } from "@/lib/agent/store"
import { buildResumeOutline, genId } from "@/lib/agent/changeset"
import { executeTool, READONLY_TOOLS } from "@/lib/agent/tools"
import { buildSystemPrompt } from "@/lib/agent/prompts"
import { streamChat } from "@/lib/agent/stream"
import type { ChatMessage, WorkspaceSelection } from "@/lib/agent/types"

const MAX_ITERATIONS = 8
const HISTORY_LIMIT = 24

export function useAgent() {
  const ws = useResumeWorkspace()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const historyRef = useRef<ChatMessage[]>([])
  const abortRef = useRef<AbortController | null>(null)

  // 最近一次请求时的选中态，供「重试」复用
  const lastSelectionRef = useRef<WorkspaceSelection | null>(null)

  useEffect(() => {
    historyRef.current = ws.turns
      .filter((turn) => turn.role === "user" || turn.content)
      .map((turn) => ({
        role: turn.role,
        content: turn.content,
      }))
    lastSelectionRef.current = null
  }, [ws.activeSessionId])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setRunning(false)
  }, [])

  // 抽出的运行循环：复用于首次发送与失败重试。historyRef 已含本轮用户消息。
  const runLoop = useCallback(
    async (assistantId: string, selection: WorkspaceSelection | null) => {
      setError(null)
      setRunning(true)
      ws.updateTurn(assistantId, (t) => ({ ...t, streaming: true, error: false }))

      const system: ChatMessage = {
        role: "system",
        content: buildSystemPrompt({
          outline: buildResumeOutline(ws.resumeRef.current),
          selection,
          jd: ws.jd,
          mode: ws.mode,
          staged: ws.staged,
        }),
      }

      const controller = new AbortController()
      abortRef.current = controller

      try {
        let iteration = 0
        while (iteration < MAX_ITERATIONS) {
          iteration += 1
          if (controller.signal.aborted) break

          const trimmedHistory = historyRef.current.slice(-HISTORY_LIMIT)
          const messages = [system, ...trimmedHistory]

          const { content, toolCalls } = await streamChat(
            messages,
            { useTools: true },
            controller.signal,
            (delta) => {
              ws.appendAssistantText(assistantId, delta)
            },
          )

          historyRef.current.push({
            role: "assistant",
            content: content || null,
            tool_calls: toolCalls.length ? toolCalls : undefined,
          })

          if (toolCalls.length === 0) break

          // 执行工具
          for (const call of toolCalls) {
            if (controller.signal.aborted) break
            let parsed: Record<string, unknown> = {}
            try {
              parsed = JSON.parse(call.function.arguments || "{}")
            } catch {
              parsed = {}
            }

            const stepId = genId("step")
            const isReadonly = READONLY_TOOLS.has(call.function.name)
            ws.addStep(assistantId, {
              id: stepId,
              tool: call.function.name,
              label: stepLabel(call.function.name),
              status: "running",
            })

            const result = executeTool(call.function.name, parsed, ws.resumeRef.current)

            if (result.change) {
              ws.stageChange(result.change)
              ws.addChangeId(assistantId, result.change.id)
            }
            if (result.card) {
              ws.addCard(assistantId, result.card)
            }
            ws.patchStep(assistantId, stepId, {
              status: result.ok ? "done" : "error",
              detail: result.change?.summary,
            })

            historyRef.current.push({
              role: "tool",
              tool_call_id: call.id,
              name: call.function.name,
              content: result.message.slice(0, isReadonly ? 6000 : 1200),
            })
          }
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          ws.updateTurn(assistantId, (t) => ({
            ...t,
            content: t.content || "（已停止）",
          }))
        } else {
          const message = err instanceof Error ? err.message : String(err)
          setError(message)
          ws.updateTurn(assistantId, (t) => ({
            ...t,
            content: t.content || `出错了：${message}`,
            error: true,
          }))
        }
      } finally {
        ws.updateTurn(assistantId, (t) => ({ ...t, streaming: false }))
        setRunning(false)
        abortRef.current = null
      }
    },
    [ws],
  )

  const send = useCallback(
    async (rawText: string, opts?: { selection?: WorkspaceSelection | null }) => {
      const text = rawText.trim()
      if (!text || running) return

      const selection = opts?.selection ?? ws.selection
      lastSelectionRef.current = selection

      ws.addTurn({
        id: genId("turn"),
        role: "user",
        content: text,
        selectionLabel: selection?.label,
      })
      const assistantId = genId("turn")
      ws.addTurn({ id: assistantId, role: "assistant", content: "", streaming: true })

      let userContent = text
      if (selection) userContent = `（选中：${selection.label}）\n${text}`
      historyRef.current.push({ role: "user", content: userContent })

      await runLoop(assistantId, selection)
    },
    [running, ws, runLoop],
  )

  // 重试：复用 historyRef 中最后一条用户消息，不新增用户气泡。
  const retry = useCallback(async () => {
    if (running) return
    // 回退到最后一条 user 消息，丢弃失败那轮产生的 assistant/tool 残留
    const hist = historyRef.current
    let lastUser = hist.length - 1
    while (lastUser >= 0 && hist[lastUser].role !== "user") lastUser--
    if (lastUser < 0) return
    historyRef.current = hist.slice(0, lastUser + 1)

    const assistantId = genId("turn")
    ws.addTurn({ id: assistantId, role: "assistant", content: "", streaming: true })
    await runLoop(assistantId, lastSelectionRef.current)
  }, [running, ws, runLoop])

  return { send, retry, stop, running, error }
}

function stepLabel(tool: string): string {
  const map: Record<string, string> = {
    get_resume: "读取简历结构",
    update_element_text: "改写文本",
    update_title: "更新标题",
    update_module: "更新模块标题",
    add_module: "新增模块",
    remove_module: "删除模块",
    reorder_modules: "重排模块",
    add_row: "新增行",
    add_rows: "新增多行",
    remove_row: "删除行",
    set_row_tags: "更新标签",
    set_personal_info: "更新个人信息",
    set_job_intention: "更新求职意向",
    set_layout: "调整布局",
    set_theme_color: "设置主题色",
    replace_resume: "整篇生成简历",
    present_score_report: "生成评分诊断",
    present_jd_match: "分析 JD 匹配",
    present_interview_questions: "准备面试问题",
    present_interview_report: "生成面试报告",
  }
  return map[tool] || tool
}
