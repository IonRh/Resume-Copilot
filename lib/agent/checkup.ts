import type { ResumeData } from "@/types/resume"
import { docToText } from "./changeset"

export type CheckupLevel = "warn" | "info"

export interface CheckupIssue {
  id: string
  level: CheckupLevel
  title: string
  detail: string
  /** 点击「让 AI 修」时发送给编辑 Agent 的指令 */
  prompt: string
}

export type AiCheckupPriority = "high" | "medium" | "low"

export interface AiCheckupIssue {
  id: string
  priority: AiCheckupPriority
  category: string
  title: string
  summary: string
  detail: string
  evidence?: string
  suggestion: string
  prompt: string
}

export interface CheckupDimension {
  name: string
  score: number
  comment?: string
}

export interface AiCheckupReport {
  summary: string
  overallScore?: number
  /** 各维度评分（内容完整性 / 量化成果 / 岗位匹配 / 表达清晰 / 排版样式 等） */
  dimensions: CheckupDimension[]
  /** 简历亮点 */
  strengths: string[]
  generatedAt: string
  issues: AiCheckupIssue[]
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/
const PHONE_RE = /(?:\+?\d[\d\s-]{6,}\d)/
const PLACEHOLDER_RE = /(请输入|示例|placeholder|lorem|待填写|xxx)/i
// 经历类模块（更应包含量化数字）
const EXPERIENCE_HINT = /(经历|经验|项目|实习|工作|实践|成果|业绩)/

const PLACEHOLDER_TITLES = new Set(["我的简历", "未命名", "简历", ""])

/** 收集某模块全部可见文本 */
function moduleText(data: ResumeData, moduleIndex: number): string {
  const m = data.modules[moduleIndex]
  if (!m) return ""
  const parts: string[] = []
  for (const row of m.rows) {
    if (row.type === "tags") parts.push((row.tags || []).join(" "))
    else for (const el of row.elements) parts.push(docToText(el.content))
  }
  return parts.join(" ").trim()
}

/**
 * 轻量启发式体检：纯本地、零网络。覆盖求职简历最常见的硬伤，
 * 作为「主动提示」，每条都附带可直接交给编辑 Agent 的修复指令。
 */
export function runCheckup(data: ResumeData): CheckupIssue[] {
  const issues: CheckupIssue[] = []

  // 1. 标题/姓名占位
  if (PLACEHOLDER_TITLES.has((data.title || "").trim())) {
    issues.push({
      id: "title",
      level: "warn",
      title: "标题未填写",
      detail: "简历标题仍是默认值，建议填写真实姓名或目标岗位。",
      prompt: "我的简历标题还是默认值，请根据简历内容建议一个合适的标题（姓名/目标岗位）并更新。",
    })
  }

  // 2. 联系方式
  const infoText = data.personalInfoSection.personalInfo
    .map((i) => i.value.content)
    .join(" ")
  if (!EMAIL_RE.test(infoText) && !PHONE_RE.test(infoText)) {
    issues.push({
      id: "contact",
      level: "warn",
      title: "缺少联系方式",
      detail: "个人信息中未检测到邮箱或电话，HR 可能无法联系到你。",
      prompt: "我的个人信息里似乎缺少邮箱或电话，请提醒我补充，并把已有联系方式整理规范。",
    })
  }

  // 3. 空模块
  const emptyModules = data.modules.filter((_, i) => moduleText(data, i).length === 0)
  if (emptyModules.length) {
    issues.push({
      id: "empty",
      level: "warn",
      title: `${emptyModules.length} 个空模块`,
      detail: `模块「${emptyModules.map((m) => m.title).join("、")}」没有任何内容。`,
      prompt: `这些模块还没有内容：${emptyModules
        .map((m) => m.title)
        .join("、")}。请帮我补充合适的示例内容，或建议删除空模块。`,
    })
  }

  // 4. 经历类模块缺量化
  const noNumberModules = data.modules.filter((m, i) => {
    if (!EXPERIENCE_HINT.test(m.title)) return false
    const t = moduleText(data, i)
    return t.length > 0 && !/\d/.test(t)
  })
  if (noNumberModules.length) {
    issues.push({
      id: "quantify",
      level: "info",
      title: "成果缺少量化",
      detail: `「${noNumberModules
        .map((m) => m.title)
        .join("、")}」缺少数字成果，量化能显著提升说服力。`,
      prompt: `请检查我的「${noNumberModules
        .map((m) => m.title)
        .join("、")}」，在不虚构的前提下，引导我把成果量化（如百分比、数量、规模），并给出改写建议。`,
    })
  }

  // 5. 占位文本残留
  const allText = data.modules.map((_, i) => moduleText(data, i)).join(" ")
  if (PLACEHOLDER_RE.test(allText)) {
    issues.push({
      id: "placeholder",
      level: "info",
      title: "存在占位文本",
      detail: "检测到“请输入/示例/待填写”等占位文字，记得替换成真实内容。",
      prompt: "我的简历里还有占位/示例文字，请帮我找出并建议替换为真实内容。",
    })
  }

  // 6. 头部求职意向与正文模块重复
  const headerJobIntentionEnabled = Boolean(
    data.jobIntentionSection?.enabled && data.jobIntentionSection.items?.length,
  )
  const duplicateJobIntentionModules = data.modules.filter((module) => /求职意向|求职方向|目标岗位|意向岗位/.test(module.title))
  if (headerJobIntentionEnabled && duplicateJobIntentionModules.length) {
    issues.push({
      id: "duplicate-job-intention",
      level: "info",
      title: "求职意向区域重复",
      detail: `页面顶部已有求职意向头部区，正文模块「${duplicateJobIntentionModules
        .map((module) => module.title)
        .join("、")}」属于冗余，预览中求职意向并不在底部。`,
      prompt: `我的简历顶部已有求职意向头部区，请删除正文模块中的冗余「${duplicateJobIntentionModules
        .map((module) => module.title)
        .join("、")}」模块，不要尝试用 reorder_modules 把求职意向移到顶部。`,
    })
  }

  // 7. 篇幅过长（粗略：正文字符数）
  const totalLen = allText.length + infoText.length
  if (totalLen > 2200) {
    issues.push({
      id: "length",
      level: "info",
      title: "篇幅可能偏长",
      detail: "内容较多，应届/初级简历建议精炼到一页。",
      prompt: "我的简历内容偏多，请帮我精简、合并冗余表达，目标控制在一页内，并保留最有价值的信息。",
    })
  }

  return issues
}

export async function runAiCheckup(data: ResumeData, signal?: AbortSignal): Promise<AiCheckupReport> {
  const res = await fetch("/api/agent/checkup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resumeData: data }),
    signal,
  })
  const payload = (await res.json().catch(() => ({}))) as AiCheckupReport & { error?: string; detail?: string }
  if (!res.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail.trim() : ""
    const summary = payload.error || `体检失败（${res.status}）`
    throw new Error(detail ? `${summary}：${detail.slice(0, 240)}` : summary)
  }
  return {
    summary: payload.summary || "AI 已完成简历体检。",
    overallScore: typeof payload.overallScore === "number" ? payload.overallScore : undefined,
    dimensions: Array.isArray(payload.dimensions) ? payload.dimensions : [],
    strengths: Array.isArray(payload.strengths) ? payload.strengths : [],
    generatedAt: payload.generatedAt || new Date().toISOString(),
    issues: Array.isArray(payload.issues) ? payload.issues : [],
  }
}
