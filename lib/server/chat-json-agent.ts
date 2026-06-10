import { extractJson } from "@/lib/server/extract-json"
import { callChatCompletions } from "@/lib/server/chat-completions"

export async function callJsonAgent(args: {
  baseUrl: string
  apiKey: string
  model: string
  messages: Array<{ role: "system" | "user"; content: string }>
  maxTokens: number
  temperature?: number
  signal?: AbortSignal
  errorLabel: string
}): Promise<Record<string, unknown>> {
  const upstream = await callChatCompletions(
    args.baseUrl,
    args.apiKey,
    {
      model: args.model,
      messages: args.messages,
      stream: false,
      temperature: args.temperature ?? 0.2,
      max_tokens: args.maxTokens,
    },
    args.signal,
  )

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "")
    throw new Error(`${args.errorLabel}：模型服务返回 ${upstream.status}${text ? `（${text.slice(0, 200)}）` : ""}`)
  }

  const payload = (await upstream.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = payload.choices?.[0]?.message?.content || ""
  const raw = extractJson(content)
  if (!raw || typeof raw !== "object") {
    throw new Error(`${args.errorLabel}：返回格式无效`)
  }
  return raw as Record<string, unknown>
}
