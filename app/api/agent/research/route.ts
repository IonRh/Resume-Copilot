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
  return `${trimmed}/chat/completions`
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/** 从 chat/completions 响应中提取正文 */
function extractContent(payload: unknown): string {
  const root = (payload || {}) as {
    choices?: Array<{ message?: { content?: unknown } }>
  }
  const content = root.choices?.[0]?.message?.content
  if (typeof content === "string") return content.trim()
  // 兼容 content 为分段数组的情况
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const p = (part || {}) as { text?: unknown }
        return typeof p.text === "string" ? p.text : ""
      })
      .join("")
      .trim()
  }
  return ""
}

export async function POST(req: Request) {
  // 研究这一步可独立配置一个「自带联网搜索」的模型（如 grok-4.x console）。
  // 未单独配置时回退到主聊天模型的配置。
  const apiKey = (process.env.RESEARCH_API_KEY ?? process.env.OPENAI_API_KEY ?? "").trim()
  const baseUrl = (
    process.env.RESEARCH_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    "https://api.openai.com/v1"
  ).trim()
  const model = (process.env.RESEARCH_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.5").trim()

  if (!apiKey) {
    return Response.json(
      { error: "未配置 RESEARCH_API_KEY / OPENAI_API_KEY，请在 .env.local 中设置后重启服务。" },
      { status: 500 },
    )
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

  const today = new Date().toISOString().slice(0, 10)

  const system = [
    "你是模拟面试前的公司与岗位研究员，具备实时联网搜索能力。",
    "你必须真正联网检索最新公开信息，绝不依赖记忆或编造；所有结论尽量给出可点击的来源 URL。",
    `今天的日期是 ${today}。`,
  ].join("\n")

  const user = [
    "请联网搜索，并为面试官整理一份可直接用于出题的研究简报。",
    "",
    `公司：${company || "用户未明确给出，请从岗位/JD 中推断"}`,
    `岗位/方向：${role || "用户未明确给出，请从 JD 中推断"}`,
    jd ? `岗位/JD/面试设定：\n${jd}` : "",
    resumeOutline ? `候选人简历结构：\n${resumeOutline.slice(0, 5000)}` : "",
    "",
    "输出要求：",
    "1. 使用简体中文，结构化 Markdown。",
    "2. 重点覆盖：公司业务/产品与近期动态、岗位关注的核心能力、相关技术栈或业务关键词、结合候选人简历最值得深挖的方向、5-8 个可用于真实面试的追问主题。",
    "3. 每个关键结论都要带上来源 URL（行内链接形式），优先引用官网、权威媒体、招聘页与真实面经。",
    "4. 不要写作答提示、参考答案或评分标准。",
  ]
    .filter(Boolean)
    .join("\n")

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
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: false,
        max_tokens: 2000,
      }),
      signal: req.signal,
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
    const detail =
      (payload as { error?: { message?: string } } | null)?.error?.message || text.slice(0, 800)
    return Response.json(
      { error: `研究服务返回 ${upstream.status}`, detail },
      { status: upstream.status || 502 },
    )
  }

  const research = extractContent(payload)
  return Response.json({ research: research || "研究完成，但没有返回可读文本。" })
}
