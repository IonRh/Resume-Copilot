"use client"

import { useCallback, useRef, useState } from "react"
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

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setRunning(false)
  }, [])

  const send = useCallback(
    async (rawText: string, opts?: { selection?: WorkspaceSelection | null }) => {
      const text = rawText.trim()
      if (!text || running) return

      const selection = opts?.selection ?? ws.selection
      setError(null)
      setRunning(true)

      // UI：用户回合 + 助手回合（流式）
      ws.addTurn({
        id: genId("turn"),
        role: "user",
        content: text,
        selectionLabel: selection?.label,
      })
      const assistantId = genId("turn")
      ws.addTurn({ id: assistantId, role: "assistant", content: "", streaming: true })

      const system: ChatMessage = {
        role: "system",
        content: buildSystemPrompt({
          outline: buildResumeOutline(ws.resumeRef.current),
          selection,
          jd: ws.jd,
          mode: ws.mode,
        }),
      }

      let userContent = text
      if (selection) userContent = `（选中：${selection.label}）\n${text}`
      historyRef.current.push({ role: "user", content: userContent })

      const controller = new AbortController()
      abortRef.current = controller

      try {
        let iteration = 0
        let firstChunkOfIteration = true
        while (iteration < MAX_ITERATIONS) {
          iteration += 1
          if (controller.signal.aborted) break

          const trimmedHistory = historyRef.current.slice(-HISTORY_LIMIT)
          const messages = [system, ...trimmedHistory]

          firstChunkOfIteration = true
          const { content, toolCalls } = await streamChat(
            messages,
            { useTools: true },
            controller.signal,
            (delta) => {
              // 多轮迭代之间用空行分隔已有文本
              if (firstChunkOfIteration) {
                firstChunkOfIteration = false
                ws.updateTurn(assistantId, (t) => ({
                  ...t,
                  content: t.content ? `${t.content}\n\n${delta}` : delta,
                }))
              } else {
                ws.appendAssistantText(assistantId, delta)
              }
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
    [running, ws],
  )

  return { send, stop, running, error }
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
  }
  return map[tool] || tool
}
