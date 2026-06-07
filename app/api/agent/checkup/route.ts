import type { ResumeData } from "@/types/resume"
import { buildResumeOutline } from "@/lib/agent/changeset"
import { runCheckup, type AiCheckupReport, type AiCheckupIssue } from "@/lib/agent/checkup"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

function resolveEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "")
  return `${trimmed}/chat/completions`
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

  return {
    summary: str(obj.summary, issues.length ? `AI 发现 ${issues.length} 个可优化点。` : "AI 未发现明显硬伤。"),
    overallScore: num(obj.overallScore),
    generatedAt: new Date().toISOString(),
    issues,
  }
}

export async function POST(req: Request) {
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim()
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").trim()
  const model = (process.env.OPENAI_MODEL ?? "gpt-5.5").trim()

  if (!apiKey) {
    return Response.json({ error: "未配置 OPENAI_API_KEY，无法执行 AI 体检。" }, { status: 500 })
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
        "你是资深招聘顾问与简历编辑专家，正在执行真正的 AI 简历体检。",
        "请基于用户简历结构、文本、样式信息和本地规则提示，输出结构化 JSON。不要输出 Markdown、解释或代码块。",
        "要求：",
        "1. 不要编造用户没有的经历、学校、公司、项目、数字或技能。",
        "2. 问题要具体，可落地，优先指出影响求职成功率的问题。",
        "3. 每条 issue 的 prompt 要能直接发给简历编辑 Agent 执行；若需要用户补充事实，就让 Agent 先询问再修改。",
        "4. issues 尽量覆盖内容完整性、岗位匹配、量化成果、表达清晰度、结构顺序、冗余、样式一致性、联系方式等维度。",
        "5. 返回 JSON 形状：{\"summary\":\"一句简易摘要\",\"overallScore\":0-100,\"issues\":[{\"id\":\"短id\",\"priority\":\"high|medium|low\",\"category\":\"类别\",\"title\":\"短标题\",\"summary\":\"一句话摘要\",\"detail\":\"完整问题说明\",\"evidence\":\"简历中的证据或位置\",\"suggestion\":\"建议怎么改\",\"prompt\":\"点击让 AI 执行时发送的中文指令\"}]}",
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
    upstream = await fetch(resolveEndpoint(baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        temperature: 0.25,
        max_tokens: 2600,
        response_format: { type: "json_object" },
      }),
      signal: req.signal,
    })
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
