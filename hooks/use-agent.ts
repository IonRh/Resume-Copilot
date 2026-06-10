"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useResumeWorkspace, type WorkspaceContextValue } from "@/lib/agent/store"
import { buildResumeOutline, genId } from "@/lib/agent/changeset"
import { executeTool, READONLY_TOOLS } from "@/lib/agent/tools"
import { buildSystemPrompt, JD_RESCORE_INSTRUCTION } from "@/lib/agent/prompts"
import { streamChat } from "@/lib/agent/stream"
import {
  BUILD_TOOL_SCHEMAS,
  COVER_LETTER_TOOL_SCHEMAS,
  DESIGN_TOOL_SCHEMAS,
  DISCOVER_TOOL_SCHEMAS,
  EDIT_TOOL_SCHEMAS,
  IMAGE_IMPORT_TOOL_SCHEMAS,
  INTERVIEW_ANALYSIS_TOOL_SCHEMAS,
  interviewerToolsForPlayMode,
  JD_RESCORE_TOOL_SCHEMAS,
  JD_TOOL_SCHEMAS,
  PROOFREAD_TOOL_SCHEMAS,
  QUANTIFY_TOOL_SCHEMAS,
  SCORE_TOOL_SCHEMAS,
} from "@/lib/agent/tool-schemas"
import type { AgentMode, ChatContentPart, ChatMessage, WorkspaceSelection } from "@/lib/agent/types"
import { useInterviewRuntime } from "@/lib/interview-runtime-context"

const HISTORY_LIMIT = 24
const STREAM_FLUSH_MS = 80
const DEFAULT_MAX_STREAM_CHARS = 12000
const ANALYSIS_MAX_STREAM_CHARS = 3500

function toolsForMode(mode: AgentMode, interviewPlayMode?: "practice" | "simulation") {
  switch (mode) {
    case "build":
      return BUILD_TOOL_SCHEMAS
    case "imageImport":
      return IMAGE_IMPORT_TOOL_SCHEMAS
    case "score":
      return SCORE_TOOL_SCHEMAS
    case "discover":
      return DISCOVER_TOOL_SCHEMAS
    case "coverLetter":
      return COVER_LETTER_TOOL_SCHEMAS
    case "jd":
      return JD_TOOL_SCHEMAS
    case "interview":
      return interviewerToolsForPlayMode(interviewPlayMode ?? "practice")
    case "interviewAnalysis":
      return INTERVIEW_ANALYSIS_TOOL_SCHEMAS
    case "proofread":
      return PROOFREAD_TOOL_SCHEMAS
    case "design":
      return DESIGN_TOOL_SCHEMAS
    case "quantify":
      return QUANTIFY_TOOL_SCHEMAS
    case "edit":
    default:
      return EDIT_TOOL_SCHEMAS
  }
}

export function useAgent(workspace?: WorkspaceContextValue) {
  const contextWorkspace = useResumeWorkspace()
  const ws = workspace ?? contextWorkspace
  const interviewRuntime = useInterviewRuntime()
  const [running, setRunning] = useState(false)
  const [rescoring, setRescoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const historyRef = useRef<ChatMessage[]>([])
  const abortRef = useRef<AbortController | null>(null)
  // 供异步回调读取的运行态镜像，避免闭包拿到过期值
  const runningRef = useRef(false)
  const rescoringRef = useRef(false)
  const rescoreAbortRef = useRef<AbortController | null>(null)

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
    runningRef.current = false
    setRunning(false)
  }, [])

  // 抽出的运行循环：复用于首次发送与失败重试。historyRef 已含本轮用户消息。
  const runLoop = useCallback(
    async (assistantId: string, selection: WorkspaceSelection | null) => {
      setError(null)
      runningRef.current = true
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
          interviewPlayMode: ws.mode === "interview" ? interviewRuntime?.playMode : undefined,
          interviewRoundId: ws.mode === "interview" ? interviewRuntime?.roundId : undefined,
        }),
      }

      const controller = new AbortController()
      abortRef.current = controller
      const maxStreamChars = ws.mode === "interviewAnalysis" ? ANALYSIS_MAX_STREAM_CHARS : DEFAULT_MAX_STREAM_CHARS
      let streamedChars = 0
      let stoppedByLimit = false
      let pendingText = ""
      let flushTimer: ReturnType<typeof setTimeout> | null = null

      const flushText = () => {
        if (!pendingText) return
        const text = pendingText
        pendingText = ""
        ws.appendAssistantText(assistantId, text)
      }

      const queueText = (text: string) => {
        if (!text) return
        pendingText += text
        if (flushTimer) return
        flushTimer = setTimeout(() => {
          flushTimer = null
          flushText()
        }, STREAM_FLUSH_MS)
      }

      const finishStreamingText = () => {
        if (flushTimer) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
        flushText()
      }

      try {
        while (!controller.signal.aborted) {
          if (controller.signal.aborted) break

          const trimmedHistory = historyRef.current.slice(-HISTORY_LIMIT)
          const messages = [system, ...trimmedHistory]
          const streamOptions = {
            tools: toolsForMode(ws.mode, interviewRuntime?.playMode),
          }

          let interviewTerminated = false

          const { content, toolCalls } = await streamChat(
            messages,
            streamOptions,
            controller.signal,
            (delta) => {
              if (stoppedByLimit) return
              const remaining = maxStreamChars - streamedChars
              if (remaining <= 0) {
                stoppedByLimit = true
                queueText("\n\n（输出过长，已自动停止。）")
                controller.abort()
                return
              }
              const accepted = delta.length > remaining ? delta.slice(0, remaining) : delta
              streamedChars += accepted.length
              queueText(accepted)
              if (delta.length > remaining || streamedChars >= maxStreamChars) {
                stoppedByLimit = true
                queueText("\n\n（输出过长，已自动停止。）")
                controller.abort()
              }
            },
          )
          finishStreamingText()

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
            if (call.function.name === "research_company_interview" && typeof parsed.jd !== "string" && ws.jd.trim()) {
              parsed.jd = ws.jd
            }

            const stepId = genId("step")
            const isReadonly = READONLY_TOOLS.has(call.function.name)
            ws.addStep(assistantId, {
              id: stepId,
              tool: call.function.name,
              label: stepLabel(call.function.name),
              status: "running",
            })

            const result = await executeTool(call.function.name, parsed, ws.resumeRef.current)

            if (result.change) {
              ws.stageChange(result.change)
              ws.addChangeId(assistantId, result.change.id)
            }
            if (result.card) {
              ws.addCard(assistantId, result.card)
              if (result.card.type === "jd") ws.setJdMatch(result.card)
            }
            ws.patchStep(assistantId, stepId, {
              status: result.ok ? "done" : "error",
              detail:
                result.change?.summary ||
                (call.function.name === "research_company_interview"
                  ? result.ok
                    ? "研究完成"
                    : result.message.slice(0, 80)
                  : undefined),
            })

            historyRef.current.push({
              role: "tool",
              tool_call_id: call.id,
              name: call.function.name,
              content: result.message.slice(0, isReadonly ? 12000 : 1200),
            })

            if (result.terminateInterview) {
              interviewRuntime?.onInterviewTerminated()
              interviewTerminated = true
            }
          }

          if (interviewTerminated) break
        }
      } catch (err) {
        finishStreamingText()
        if ((err as Error)?.name === "AbortError") {
          ws.updateTurn(assistantId, (t) => ({
            ...t,
            content: t.content || (stoppedByLimit ? "（输出过长，已自动停止。）" : "（已停止）"),
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
        finishStreamingText()
        ws.updateTurn(assistantId, (t) => ({ ...t, streaming: false }))
        runningRef.current = false
        setRunning(false)
        abortRef.current = null
      }
    },
    [ws, interviewRuntime],
  )

  /**
   * 静默重新评分：简历被修改后调用。仅读取最新简历并重出匹配卡片，
   * 结果写入 ws.jdMatch（不污染聊天流），用于驱动常驻匹配面板的分数演进。
   */
  const rescore = useCallback(async () => {
    if (ws.mode !== "jd") return
    if (runningRef.current || rescoringRef.current) return
    rescoringRef.current = true
    setRescoring(true)
    const controller = new AbortController()
    rescoreAbortRef.current = controller
    try {
      const system: ChatMessage = {
        role: "system",
        content: buildSystemPrompt({
          outline: buildResumeOutline(ws.resumeRef.current),
          selection: null,
          jd: ws.jd,
          mode: "jd",
          staged: ws.staged,
        }),
      }
      const history: ChatMessage[] = [{ role: "user", content: JD_RESCORE_INSTRUCTION }]
      while (!controller.signal.aborted) {
        if (controller.signal.aborted) break
        const { content, toolCalls } = await streamChat(
          [system, ...history],
          { tools: JD_RESCORE_TOOL_SCHEMAS },
          controller.signal,
          () => {
            /* 重新评分不向聊天流输出文本 */
          },
        )
        history.push({
          role: "assistant",
          content: content || null,
          tool_calls: toolCalls.length ? toolCalls : undefined,
        })
        if (toolCalls.length === 0) break

        let gotCard = false
        for (const call of toolCalls) {
          if (controller.signal.aborted) break
          let parsed: Record<string, unknown> = {}
          try {
            parsed = JSON.parse(call.function.arguments || "{}")
          } catch {
            parsed = {}
          }
          const result = await executeTool(call.function.name, parsed, ws.resumeRef.current)
          if (result.card?.type === "jd") {
            ws.setJdMatch(result.card)
            gotCard = true
          }
          const isReadonly = READONLY_TOOLS.has(call.function.name)
          history.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            content: result.message.slice(0, isReadonly ? 12000 : 1200),
          })
        }
        if (gotCard) break
      }
    } catch {
      /* 重新评分失败静默处理，不打断主流程 */
    } finally {
      rescoringRef.current = false
      setRescoring(false)
      rescoreAbortRef.current = null
    }
  }, [ws])

  const send = useCallback(
    async (
      rawText: string,
      opts?: {
        selection?: WorkspaceSelection | null
        displayText?: string
        attachments?: ChatContentPart[]
      },
    ) => {
      const text = rawText.trim()
      if (!text || running) return false

      const selection = opts?.selection ?? ws.selection
      const visibleText = opts?.displayText?.trim() || text
      lastSelectionRef.current = selection

      ws.addTurn({
        id: genId("turn"),
        role: "user",
        content: visibleText,
        selectionLabel: selection?.label,
      })
      const assistantId = genId("turn")
      ws.addTurn({ id: assistantId, role: "assistant", content: "", streaming: true })

      let userContent = text
      if (selection) userContent = `（选中：${selection.label}）\n${text}`
      historyRef.current.push({
        role: "user",
        content: opts?.attachments?.length
          ? [{ type: "text", text: userContent }, ...opts.attachments]
          : userContent,
      })

      await runLoop(assistantId, selection)
      return true
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

  return { send, retry, stop, rescore, running, rescoring, error }
}

function stepLabel(tool: string): string {
  const map: Record<string, string> = {
    get_resume: "读取简历结构",
    set_cover_letter: "准备自荐信",
    research_company_interview: "深入研究公司中",
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
    present_career_directions: "推荐岗位方向",
    present_jd_match: "分析 JD 匹配",
    plan_interview_questions: "规划面试问题",
    present_interview_question: "展示当前面试题",
    present_interview_questions: "展示面试问题",
    present_interview_report: "生成面试报告",
    terminate_interview: "终止面试",
  }
  return map[tool] || tool
}
