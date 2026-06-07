import { assertResumeApiAuthorized, unauthorizedResponse } from "@/lib/server/api-auth"
import { APPLICATION_STATUS_FLOW } from "@/types/application"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

interface ApplicationSummary {
  company?: string
  position?: string
  channel?: string
  status?: string
  priority?: string
  appliedAt?: string
  ageDays?: number
  resumeTitle?: string
  nextAction?: string
}

interface InsightsRequest {
  applications?: ApplicationSummary[]
  stats?: Record<string, unknown>
}

export interface ApplicationInsightItem {
  title: string
  detail: string
  priority?: "high" | "medium" | "low"
}

export interface ApplicationInsightsReport {
  summary: string
  observations: ApplicationInsightItem[]
  recommendations: ApplicationInsightItem[]
  generatedAt: string
}

function resolveEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
    if (fenced?.[1]) return JSON.parse(fenced[1])
    const start = trimmed.indexOf("{")
    const end = trimmed.lastIndexOf("}")
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
    throw new Error("模型没有返回合法 JSON")
  }
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v.trim() : fallback)

function normalizePriority(v: unknown): ApplicationInsightItem["priority"] {
  return v === "high" || v === "medium" || v === "low" ? v : undefined
}

function normalizeItems(raw: unknown, limit: number): ApplicationInsightItem[] {
  if (!Array.isArray(raw)) return []
  const items: ApplicationInsightItem[] = []
  for (const entry of raw) {
    if (items.length >= limit) break
    const it = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>
    const title = str(it.title)
    const detail = str(it.detail)
    if (!title || !detail) continue
    items.push({ title, detail, priority: normalizePriority(it.priority) })
  }
  return items
}

function buildStatsLine(applications: ApplicationSummary[]): string {
  const counts = new Map<string, number>()
  applications.forEach((a) => counts.set(a.status || "unknown", (counts.get(a.status || "unknown") || 0) + 1))
  return APPLICATION_STATUS_FLOW.map((s) => `${s.label}:${counts.get(s.value) || 0}`).join(" / ")
}

export async function POST(req: Request) {
  try {
    await assertResumeApiAuthorized()
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
  }

  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim()
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").trim()
  const model = (process.env.OPENAI_MODEL ?? "gpt-5.5").trim()
  if (!apiKey) {
    return Response.json({ error: "未配置 OPENAI_API_KEY，无法生成投递复盘。" }, { status: 500 })
  }

  let body: InsightsRequest
  try {
    body = (await req.json()) as InsightsRequest
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 })
  }

  const applications = Array.isArray(body.applications) ? body.applications.slice(0, 200) : []
  if (applications.length === 0) {
    return Response.json({ error: "没有可供分析的投递记录" }, { status: 400 })
  }

  const tableLines = applications.map((a, i) => {
    const parts = [
      `${i + 1}.`,
      `${str(a.company, "未知公司")} / ${str(a.position, "未知岗位")}`,
      `阶段:${str(a.status, "applied")}`,
      a.channel ? `渠道:${a.channel}` : "",
      a.priority ? `优先级:${a.priority}` : "",
      typeof a.ageDays === "number" ? `已投${a.ageDays}天` : "",
      a.resumeTitle ? `简历:${a.resumeTitle}` : "无关联简历",
      a.nextAction ? `下一步:${a.nextAction}` : "",
    ].filter(Boolean)
    return parts.join(" | ")
  })

  const messages = [
    {
      role: "system",
      content: [
        "你是资深求职教练，正在帮助一名求职者复盘其投递数据，给出可执行的策略建议。",
        "只输出 JSON，不要 Markdown、解释或代码块。",
        "要求：",
        "1. 不要编造数据中没有的信息；所有结论必须基于给定的投递列表与统计。",
        "2. observations 是对当前投递分布/进展的客观洞察（如阶段卡点、渠道偏好、简历复用情况、停滞过久的投递）。",
        "3. recommendations 是下一步可执行的策略建议，按重要性排序，priority 取 high/medium/low。",
        "4. 语言简体中文，每条 detail 一两句话、具体可操作。",
        '5. 返回 JSON 形状：{"summary":"一句话总体判断","observations":[{"title":"短标题","detail":"说明"}],"recommendations":[{"title":"短标题","detail":"建议","priority":"high|medium|low"}]}',
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `【投递总数】${applications.length}`,
        `【阶段分布】${buildStatsLine(applications)}`,
        "",
        "【投递明细】",
        tableLines.join("\n").slice(0, 12000),
      ].join("\n"),
    },
  ]

  let upstream: Response
  try {
    upstream = await fetch(resolveEndpoint(baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        temperature: 0.3,
        max_tokens: 1800,
        response_format: { type: "json_object" },
      }),
      signal: req.signal,
    })
  } catch (err) {
    return Response.json({ error: `无法连接模型服务：${err instanceof Error ? err.message : String(err)}` }, { status: 502 })
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "")
    return Response.json({ error: `模型服务返回 ${upstream.status}`, detail: text.slice(0, 800) }, { status: upstream.status || 502 })
  }

  try {
    const payload = (await upstream.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const raw = extractJson(payload.choices?.[0]?.message?.content || "") as Record<string, unknown>
    const report: ApplicationInsightsReport = {
      summary: str(raw?.summary, "已根据当前投递数据生成复盘。"),
      observations: normalizeItems(raw?.observations, 8),
      recommendations: normalizeItems(raw?.recommendations, 8),
      generatedAt: new Date().toISOString(),
    }
    return Response.json(report)
  } catch (err) {
    return Response.json({ error: "复盘结果解析失败", detail: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }
}
