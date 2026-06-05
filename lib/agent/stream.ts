import { genId } from "./changeset"
import type { ChatMessage, ToolCall } from "./types"

export interface StreamResult {
  content: string
  toolCalls: ToolCall[]
}

export interface StreamOptions {
  /** 默认 true：挂载全部简历工具。传 false 关闭工具 */
  useTools?: boolean
  /** 覆盖工具集（如 intake 仅挂 finish_intake）。优先级高于 useTools */
  tools?: unknown[]
  /** 与 tools 搭配的 tool_choice，默认 "auto" */
  toolChoice?: unknown
}

/**
 * 调用服务端代理（/api/agent/chat），按 OpenAI 兼容 SSE 流式解析文本与工具调用。
 * 抽离为独立模块，供编辑器 Agent 与 intake 模态框共用。
 */
export async function streamChat(
  messages: ChatMessage[],
  opts: StreamOptions,
  signal: AbortSignal,
  onText: (delta: string) => void,
): Promise<StreamResult> {
  const body: Record<string, unknown> = { messages }
  if (opts.tools) {
    body.tools = opts.tools
    body.toolChoice = opts.toolChoice ?? "auto"
  } else {
    body.useTools = opts.useTools !== false
  }

  const res = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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
