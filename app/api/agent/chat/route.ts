import { TOOL_SCHEMAS } from "@/lib/agent/tool-schemas"
import type { ChatMessage } from "@/lib/agent/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

interface RequestBody {
  messages: ChatMessage[]
  /** 仅在该轮需要工具时为 true（如纯文本追问可关闭以省 token） */
  useTools?: boolean
  temperature?: number
}

function resolveEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "")
  return `${trimmed}/chat/completions`
}

export async function POST(req: Request) {
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim()
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").trim()
  const model = (process.env.OPENAI_MODEL ?? "gpt-5.5").trim()

  if (!apiKey) {
    return Response.json(
      { error: "未配置 OPENAI_API_KEY，请在 .env.local 中设置后重启服务。" },
      { status: 500 },
    )
  }

  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 })
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "缺少 messages" }, { status: 400 })
  }

  const payload: Record<string, unknown> = {
    model,
    messages: body.messages,
    stream: true,
    temperature: body.temperature ?? 0.4,
  }
  if (body.useTools !== false) {
    payload.tools = TOOL_SCHEMAS
    payload.tool_choice = "auto"
  }

  let upstream: Response
  try {
    upstream = await fetch(resolveEndpoint(baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: `无法连接模型服务：${message}` }, { status: 502 })
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "")
    return Response.json(
      { error: `模型服务返回 ${upstream.status}`, detail: text.slice(0, 800) },
      { status: upstream.status || 502 },
    )
  }

  // 直接透传上游 SSE 流，由客户端解析 delta / tool_calls
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
    },
  })
}
