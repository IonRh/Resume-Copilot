import type { ResumeData } from "@/types/resume"
import { buildResumeOutline } from "@/lib/agent/changeset"
import {
  runCheckup,
  type AiCheckupReport,
  type AiCheckupIssue,
  type CheckupDimension,
} from "@/lib/agent/checkup"
import { loadAiProviderConfig } from "@/lib/server/ai-config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

function resolveEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "")
  return `${trimmed}/chat/completions`
}

async function callChatCompletions(
  baseUrl: string,
  apiKey: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const endpoint = resolveEndpoint(baseUrl)
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
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

function normalizePriority(v: unknown): AiCheckupIssue["priority"] {
  return v === "high" || v === "medium" || v === "low" ? v : "medium"
}

function clampScore(v: unknown): number | undefined {
  const n = num(v)
  if (n === undefined) return undefined
  return Math.max(0, Math.min(100, Math.round(n)))
}

function normalizeDimensions(raw: unknown): CheckupDimension[] {
  if (!Array.isArray(raw)) return []
  const dims: CheckupDimension[] = []
  for (const item of raw) {
    if (dims.length >= 8) break
    const it = (item && typeof item === "object" ? item : {}) as Record<string, unknown>
    const name = str(it.name)
    const score = clampScore(it.score)
    if (!name || score === undefined) continue
    dims.push({ name, score, comment: str(it.comment) || undefined })
  }
  return dims
}

function normalizeStrengths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((s) => str(s))
    .filter(Boolean)
    .slice(0, 6)
}

function normalizeReport(raw: unknown): AiCheckupReport {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const rawIssues = Array.isArray(obj.issues) ? obj.issues : []
  const issues: AiCheckupIssue[] = []
  rawIssues.forEach((item, index) => {
    if (issues.length >= 12) return
    const it = (item && typeof item === "object" ? item : {}) as Record<string, unknown>
    const title = str(it.title)
    const summary = str(it.summary)
    const detail = str(it.detail)
    const suggestion = str(it.suggestion)
    const prompt = str(it.prompt)
    if (!title || !summary || !detail || !suggestion || !prompt) return
    issues.push({
      id: str(it.id, `ai-checkup-${index + 1}`),
      priority: normalizePriority(it.priority),
      category: str(it.category, "综合优化"),
      title,
      summary,
      detail,
      evidence: str(it.evidence) || undefined,
      suggestion,
      prompt,
    })
  })

  const dimensions = normalizeDimensions(obj.dimensions)
  // 兜底：模型给了维度分却漏了总分时，用维度均分估算
  let overallScore = clampScore(obj.overallScore)
  if (overallScore === undefined && dimensions.length) {
    overallScore = Math.round(dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length)
  }

  return {
    summary: str(obj.summary, issues.length ? `AI 发现 ${issues.length} 个可优化点。` : "AI 未发现明显硬伤。"),
    overallScore,
    dimensions,
    strengths: normalizeStrengths(obj.strengths),
    generatedAt: new Date().toISOString(),
    issues,
  }
}

export async function POST(req: Request) {
  const { apiKey, baseUrl, model } = await loadAiProviderConfig()

  if (!apiKey) {
    return Response.json({ error: "未配置 API Key，无法执行 AI 体检。" }, { status: 500 })
  }

  let resumeData: ResumeData | null = null
  try {
    const body = (await req.json()) as { resumeData?: ResumeData }
    resumeData = body.resumeData || null
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 })
  }
  if (!resumeData) return Response.json({ error: "缺少 resumeData" }, { status: 400 })

  const outline = buildResumeOutline(resumeData)
  const heuristicIssues = runCheckup(resumeData)

  const messages = [
    {
      role: "system",
      content: [
        "你是资深招聘顾问与简历编辑专家，正在执行真正的 AI 简历体检。体检 = 站在 HR/招聘官视角的客观诊断 + 量化评分 + 可落地的优化项。",
        "请基于用户简历结构、文本、样式信息和本地规则提示，输出结构化 JSON。不要输出 Markdown、解释或代码块。",
        "要求：",
        "1. 不要编造用户没有的经历、学校、公司、项目、数字或技能。",
        "2. 必须给出 overallScore（0-100 的综合得分）以及 dimensions 维度评分。dimensions 固定覆盖这 5 个维度，按此命名：内容完整性、量化成果、岗位匹配、表达清晰、排版样式；每个维度给 0-100 分和一句简短点评 comment。综合分应与维度分、issues 严重度自洽（硬伤多则低分）。",
        "3. strengths 列出 2-4 条简历真实亮点（无明显亮点可给空数组）。",
        "4. 问题要具体、可落地，按优先级排序，优先指出影响求职成功率的问题；issues 尽量覆盖内容完整性、岗位匹配、量化成果、表达清晰度、结构顺序、冗余、样式一致性、联系方式等维度。",
        "5. 每条 issue 的 prompt 要能直接发给简历编辑 Agent 执行；若需要用户补充事实，就让 Agent 先询问再修改。",
        "6. 返回 JSON 形状：{\"summary\":\"一句话总评\",\"overallScore\":0-100,\"dimensions\":[{\"name\":\"内容完整性\",\"score\":0-100,\"comment\":\"一句点评\"}],\"strengths\":[\"亮点\"],\"issues\":[{\"id\":\"短id\",\"priority\":\"high|medium|low\",\"category\":\"类别\",\"title\":\"短标题\",\"summary\":\"一句话摘要\",\"detail\":\"完整问题说明\",\"evidence\":\"简历中的证据或位置\",\"suggestion\":\"建议怎么改\",\"prompt\":\"点击让 AI 执行时发送的中文指令\"}]}",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "【当前简历结构与样式】",
        outline.slice(0, 14000),
        "",
        "【本地规则预检结果，仅供参考，不代表最终结论】",
        heuristicIssues.length
          ? heuristicIssues.map((it, i) => `${i + 1}. ${it.title}: ${it.detail}`).join("\n")
          : "本地规则未发现明显硬伤。",
      ].join("\n"),
    },
  ]

  let upstream: Response
  try {
    upstream = await callChatCompletions(
      baseUrl,
      apiKey,
      {
        model,
        messages,
        stream: false,
        temperature: 0.25,
        max_tokens: 2600,
      },
      req.signal,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: `无法连接模型服务：${message}` }, { status: 502 })
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "")
    return Response.json(
      { error: `模型服务返回 ${upstream.status}`, detail: text.slice(0, 800) },
      { status: upstream.status || 502 },
    )
  }

  try {
    const payload = (await upstream.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = payload.choices?.[0]?.message?.content || ""
    return Response.json(normalizeReport(extractJson(content)))
  } catch (err) {
    return Response.json(
      { error: "AI 体检结果解析失败", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    )
  }
}
