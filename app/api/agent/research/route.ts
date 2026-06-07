export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

interface ResearchRequest {
  company?: string
  role?: string
  jd?: string
  resumeOutline?: string
}

function resolveEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "")
  return `${trimmed}/responses`
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function extractResearch(payload: unknown): string {
  const root = (payload || {}) as { output?: unknown[]; output_text?: unknown }
  if (typeof root.output_text === "string") return root.output_text.trim()
  const lines: string[] = []
  for (const item of root.output || []) {
    const obj = (item || {}) as { content?: unknown[]; type?: string }
    if (!Array.isArray(obj.content)) continue
    for (const part of obj.content) {
      const p = (part || {}) as { text?: unknown }
      if (typeof p.text === "string") lines.push(p.text)
    }
  }
  return lines.join("\n").trim()
}

export async function POST(req: Request) {
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim()
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").trim()
  const model = (process.env.OPENAI_MODEL ?? "gpt-5.5").trim()

  if (!apiKey) {
    return Response.json({ error: "未配置 OPENAI_API_KEY，请在 .env.local 中设置后重启服务。" }, { status: 500 })
  }

  let body: ResearchRequest
  try {
    body = (await req.json()) as ResearchRequest
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 })
  }

  const company = str(body.company)
  const role = str(body.role)
  const jd = str(body.jd)
  const resumeOutline = str(body.resumeOutline)
  if (!company && !role && !jd) {
    return Response.json({ error: "缺少公司、岗位或 JD 信息" }, { status: 400 })
  }

  const input = [
    "你是模拟面试前的公司与岗位研究员。请联网搜索，并为面试官整理可直接用于出题的研究简报。",
    "",
    `公司：${company || "用户未明确给出，请从岗位/JD 中推断"}`,
    `岗位/方向：${role || "用户未明确给出，请从 JD 中推断"}`,
    jd ? `岗位/JD/面试设定：\n${jd}` : "",
    resumeOutline ? `候选人简历结构：\n${resumeOutline.slice(0, 5000)}` : "",
    "",
    "输出要求：",
    "1. 使用简体中文。",
    "2. 重点覆盖：公司业务/产品、岗位可能关注的能力、相关技术栈或业务关键词、结合候选人简历最适合深挖的方向、5-8 个可用于真实面试的追问主题。",
    "3. 尽量给出来源 URL；若搜索结果没有引用标注，也要列出你用到的公开页面 URL。",
    "4. 不要写作答提示、参考答案或评分标准。",
  ].filter(Boolean).join("\n")

  let upstream: Response
  try {
    upstream = await fetch(resolveEndpoint(baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input,
        tools: [{ type: "web_search_preview" }],
        max_output_tokens: 1200,
      }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: `无法连接研究服务：${message}` }, { status: 502 })
  }

  const text = await upstream.text().catch(() => "")
  let payload: unknown = null
  try {
    payload = JSON.parse(text)
  } catch {
    payload = null
  }

  if (!upstream.ok) {
    return Response.json(
      { error: `研究服务返回 ${upstream.status}`, detail: text.slice(0, 800) },
      { status: upstream.status || 502 },
    )
  }

  const research = extractResearch(payload)
  return Response.json({ research: research || "研究完成，但没有返回可读文本。" })
}
