"use client"

import { useCallback, useRef, useState } from "react"
import { useResumeWorkspace } from "@/lib/agent/store"
import { buildResumeOutline, genId } from "@/lib/agent/changeset"
import { executeTool, READONLY_TOOLS } from "@/lib/agent/tools"
import type { AgentMode, ChatMessage, ToolCall, WorkspaceSelection } from "@/lib/agent/types"

const MAX_ITERATIONS = 8
const HISTORY_LIMIT = 24

interface StreamResult {
  content: string
  toolCalls: ToolCall[]
}

const MODE_GUIDE: Record<AgentMode, string> = {
  edit:
    "当前为「编辑」模式：根据用户需求润色、改写、增删或重排简历内容与样式。优先使用 update_element_text 改写措辞。",
  score:
    "当前为「评分诊断」模式：客观评估简历，必须调用 present_score_report 输出结构化评分与改进建议，再用简短文字总结。",
  jd:
    "当前为「JD 匹配」模式：对照下方 JD 分析匹配度，必须调用 present_jd_match 输出匹配卡片；每条建议尽量附 prompt，便于用户一键让你执行。",
  interview:
    "当前为「模拟面试」模式：基于简历(及 JD)进行文本面试。首次应调用 present_interview_questions 给出问题清单；用户作答后给予点评与追问，此时无需再调用工具。",
}

function buildSystemPrompt(args: {
  outline: string
  selection: WorkspaceSelection | null
  jd: string
  mode: AgentMode
}): string {
  const { outline, selection, jd, mode } = args
  const lines: string[] = [
    "你是一个 AI-Native 简历助手，内嵌于一款简历编辑器中，能够直接操作简历的所有元素。",
    "你通过调用工具来修改简历。所有「修改类」工具只会生成待确认的变更（diff），由用户审阅后才真正生效——因此请用「我已为你准备/建议」这类措辞，不要声称已直接改好。",
    "重要规则：",
    "1. 元素通过 id 定位。若不确定 id 或当前内容，先调用 get_resume 获取结构大纲。",
    "2. 改写正文措辞优先用 update_element_text；调整结构用 add/remove/reorder 等；调整布局样式用 set_layout / set_theme_color。",
    "3. 一次回复可调用多个工具完成一项任务；完成后用 1-3 句中文说明你做了什么、为什么。",
    "4. 始终使用简体中文，语气专业、简洁，像资深求职顾问。",
    "5. 不要编造用户简历中不存在的经历；润色时保持事实，强化表达与量化。",
    MODE_GUIDE[mode],
    "",
    "【当前简历结构】",
    outline,
  ]
  if (selection) {
    lines.push(
      "",
      `【用户当前选中】${selection.label}（${selection.kind} id=${selection.id}）。若指令含「这个/此处/选中的」，优先围绕该元素操作。`,
    )
    if (selection.text) lines.push(`选中文本内容：「${selection.text}」`)
  }
  if (jd.trim()) {
    lines.push("", "【目标岗位 JD】", jd.trim())
  }
  return lines.join("\n")
}

async function streamChat(
  messages: ChatMessage[],
  useTools: boolean,
  signal: AbortSignal,
  onText: (delta: string) => void,
): Promise<StreamResult> {
  const res = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, useTools }),
    signal,
  })

  if (!res.ok || !res.body) {
    let detail = ""
    try {
      const j = await res.json()
      detail = j?.error || j?.detail || ""
    } catch {
      /* ignore */
    }
    throw new Error(detail || `请求失败（${res.status}）`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let content = ""
  const toolAcc: Record<number, { id: string; name: string; args: string }> = {}

  const handlePayload = (payload: string) => {
    if (payload === "[DONE]") return
    let json: {
      choices?: Array<{
        delta?: {
          content?: string
          tool_calls?: Array<{
            index?: number
            id?: string
            function?: { name?: string; arguments?: string }
          }>
        }
      }>
    }
    try {
      json = JSON.parse(payload)
    } catch {
      return
    }
    const delta = json.choices?.[0]?.delta
    if (!delta) return
    if (typeof delta.content === "string" && delta.content) {
      content += delta.content
      onText(delta.content)
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0
        if (!toolAcc[idx]) toolAcc[idx] = { id: "", name: "", args: "" }
        if (tc.id) toolAcc[idx].id = tc.id
        if (tc.function?.name) toolAcc[idx].name += tc.function.name
        if (tc.function?.arguments) toolAcc[idx].args += tc.function.arguments
      }
    }
  }

  // 解析 SSE：逐行读取，data: 前缀的载荷
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const raw of lines) {
      const line = raw.trim()
      if (!line || line.startsWith(":")) continue
      if (line.startsWith("data:")) handlePayload(line.slice(5).trim())
    }
  }
  if (buffer.trim().startsWith("data:")) handlePayload(buffer.trim().slice(5).trim())

  const toolCalls: ToolCall[] = Object.keys(toolAcc)
    .map((k) => Number(k))
    .sort((a, b) => a - b)
    .map((idx) => toolAcc[idx])
    .filter((t) => t.name)
    .map((t) => ({
      id: t.id || genId("call"),
      type: "function" as const,
      function: { name: t.name, arguments: t.args || "{}" },
    }))

  return { content, toolCalls }
}

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
            true,
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
