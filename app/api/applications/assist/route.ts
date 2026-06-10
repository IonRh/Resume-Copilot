import type { ResumeData } from "@/types/resume"
import { assertResumeApiAuthorized, unauthorizedResponse } from "@/lib/server/api-auth"
import { loadAiProviderConfig } from "@/lib/server/ai-config"
import { callChatCompletions } from "@/lib/server/chat-completions"
import { buildResumeOutline } from "@/lib/agent/changeset"
import { getStatusMeta, type ApplicationStatus } from "@/types/application"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

interface AssistRequest {
  application?: {
    company?: string
    position?: string
    status?: ApplicationStatus
    channel?: string
    appliedAt?: string
    ageDays?: number
    nextAction?: string
    jdText?: string
    jdUrl?: string
    notes?: string
    resumeTitle?: string
  }
  resumeData?: ResumeData
}

export interface ApplicationAssistResult {
  summary: string
  nextSteps: { action: string; reason?: string }[]
  followUpMessage: string
  interviewTopics: string[]
  generatedAt: string
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

function normalizeSteps(raw: unknown): ApplicationAssistResult["nextSteps"] {
  if (!Array.isArray(raw)) return []
  const steps: ApplicationAssistResult["nextSteps"] = []
  for (const entry of raw) {
    if (steps.length >= 5) break
    if (typeof entry === "string") {
      const action = entry.trim()
      if (action) steps.push({ action })
      continue
    }
    const it = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>
    const action = str(it.action)
    if (!action) continue
    steps.push({ action, reason: str(it.reason) || undefined })
  }
  return steps
}

function normalizeTopics(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((v) => str(v)).filter(Boolean).slice(0, 8)
}

export async function POST(req: Request) {
  try {
    await assertResumeApiAuthorized()
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorizedResponse()
  }

  const { apiKey, baseUrl, model } = await loadAiProviderConfig()
  if (!apiKey) {
    return Response.json({ error: "未配置 API Key，无法生成投递建议。" }, { status: 500 })
  }

  let body: AssistRequest
  try {
    body = (await req.json()) as AssistRequest
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 })
  }

  const app = body.application
  if (!app || (!app.company && !app.position)) {
    return Response.json({ error: "缺少投递信息" }, { status: 400 })
  }

  const status = app.status || "applied"
  const statusLabel = getStatusMeta(status).label
  const outline = body.resumeData ? buildResumeOutline(body.resumeData).slice(0, 8000) : ""

  const messages = [
    {
      role: "system",
      content: [
        "你是一名贴身求职教练，针对求职者的某一条具体投递，给出当前阶段最该做的事。",
        "只输出 JSON，不要 Markdown、解释或代码块。",
        "要求：",
        "1. 紧扣“当前阶段”给建议：想投→投递准备；已投递→跟进与等待策略；笔试/测评→针对性准备；面试中→面试准备与复盘；offer→谈薪与决策；未通过/已关闭→复盘与迁移。",
        "2. nextSteps：2-4 条，按先后顺序，action 是可直接执行的动作，reason 简述理由。",
        "3. followUpMessage：一段可直接复制发给 HR/面试官的中文跟进消息（礼貌、简洁、个性化到公司与岗位）；若当前阶段不适合跟进则给出空字符串。",
        "4. interviewTopics：仅当处于笔试/测评或面试阶段时，给 4-6 个最可能被深挖的主题；否则返回空数组。",
        "5. 不要编造简历里没有的经历或数字。",
        '6. 返回 JSON 形状：{"summary":"一句话当前阶段判断","nextSteps":[{"action":"动作","reason":"理由"}],"followUpMessage":"可复制的跟进消息或空串","interviewTopics":["主题"]}',
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `【投递】${str(app.company, "未知公司")} / ${str(app.position, "未知岗位")}`,
        `【当前阶段】${statusLabel}`,
        app.channel ? `【渠道】${app.channel}` : "",
        typeof app.ageDays === "number" ? `【已投递天数】${app.ageDays}` : "",
        app.nextAction ? `【已记录的下一步】${app.nextAction}` : "",
        app.notes ? `【个人备注】${app.notes}` : "",
        app.jdText ? `【JD 要点】\n${app.jdText.slice(0, 4000)}` : "",
        outline ? `【关联简历结构】\n${outline}` : "【未关联简历】",
      ].filter(Boolean).join("\n"),
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
        temperature: 0.35,
        max_tokens: 1600,
      },
      req.signal,
    )
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
    const result: ApplicationAssistResult = {
      summary: str(raw?.summary, `当前处于「${statusLabel}」阶段。`),
      nextSteps: normalizeSteps(raw?.nextSteps),
      followUpMessage: str(raw?.followUpMessage),
      interviewTopics: normalizeTopics(raw?.interviewTopics),
      generatedAt: new Date().toISOString(),
    }
    return Response.json(result)
  } catch (err) {
    return Response.json({ error: "投递建议解析失败", detail: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }
}
