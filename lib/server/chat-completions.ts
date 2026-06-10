export function resolveChatCompletionsEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`
}

/**
 * 调用 OpenAI 兼容 chat/completions。
 * 先尝试 json_object；若上游返回 400（常见于不支持 response_format 的网关/模型），自动去掉该字段重试。
 */
export async function callChatCompletions(
  baseUrl: string,
  apiKey: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const endpoint = resolveChatCompletionsEndpoint(baseUrl)
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  }

  const withJsonMode = { ...payload, response_format: { type: "json_object" } }
  let upstream = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(withJsonMode),
    signal,
  })

  if (upstream.status === 400) {
    await upstream.text().catch(() => "")
    upstream = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    })
  }

  return upstream
}
