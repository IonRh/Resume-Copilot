/**
 * 主页常驻「求职管家」Copilot 的纯逻辑层（无副作用、无 React）。
 *
 * 职责：
 *  - 把用户的简历 + 投递汇总成「求职现状」信号与精简文本（注入 system prompt）。
 *  - 定义管家可调用的展示工具 suggest_actions（由客户端渲染成可点击按钮）。
 *  - 提供无 API key / 出错时的确定性兜底（现状播报 + 推荐下一步）。
 */

import type { StoredResume } from "@/types/resume"
import type { ApplicationStatus, JobApplication } from "@/types/application"
import { ACTIVE_APPLICATION_STATUSES, APPLICATION_STATUS_FLOW } from "@/types/application"

/** 管家可发起的行动意图类型 */
export type CopilotActionKind =
  | "create_resume"
  | "edit_resume"
  | "polish"
  | "jd_match"
  | "discover"
  | "interview"
  | "applications"

/** 一个可点击的行动入口（由模型产出或兜底生成，点击后由 user-center 路由） */
export interface CopilotAction {
  kind: CopilotActionKind
  label: string
  /** 针对某份简历的操作需要带上其 id */
  resumeId?: string
  /** 可选：一句话说明推荐理由 */
  reason?: string
}

/** 行动按钮的图标与默认文案（组件与兜底共用） */
export const COPILOT_ACTION_META: Record<CopilotActionKind, { icon: string; label: string }> = {
  create_resume: { icon: "mdi:plus", label: "创建简历" },
  edit_resume: { icon: "mdi:pencil", label: "编辑简历" },
  polish: { icon: "mdi:auto-fix", label: "润色简历" },
  jd_match: { icon: "mdi:target", label: "做 JD 匹配" },
  discover: { icon: "mdi:compass-outline", label: "岗位方向推荐" },
  interview: { icon: "mdi:account-voice", label: "模拟面试" },
  applications: { icon: "mdi:briefcase-check-outline", label: "查看投递" },
}

const ACTION_KINDS: CopilotActionKind[] = [
  "create_resume",
  "edit_resume",
  "polish",
  "jd_match",
  "discover",
  "interview",
  "applications",
]

/** 求职现状的结构化信号，用于兜底决策与红点统计 */
export interface JobSearchSignals {
  resumeCount: number
  draftCount: number
  variantCount: number
  latestResume?: { id: string; title: string; buildMode: boolean }
  applicationCount: number
  statusCounts: Record<ApplicationStatus, number>
  activeCount: number
  /** 进行中且超过 7 天未更新的投递数（可能需要跟进） */
  staleCount: number
  interviewCount: number
  offerCount: number
}

export interface CopilotContext {
  signals: JobSearchSignals
  /** 注入 system prompt 的精简现状文本 */
  summary: string
}

function daysSince(iso?: string): number | undefined {
  if (!iso) return undefined
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return undefined
  return Math.max(0, Math.floor((Date.now() - t) / 86400000))
}

function emptyStatusCounts(): Record<ApplicationStatus, number> {
  return {
    wishlist: 0,
    applied: 0,
    assessment: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    closed: 0,
  }
}

function titleOf(entry: StoredResume): string {
  return entry.resumeData.title || "未命名"
}

/** 汇总简历 + 投递为信号与精简文本 */
export function buildCopilotContext(
  resumes: StoredResume[],
  applications: JobApplication[],
): CopilotContext {
  const sortedResumes = [...resumes].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )
  const latest = sortedResumes[0]
  const statusCounts = emptyStatusCounts()
  applications.forEach((a) => {
    if (statusCounts[a.status] !== undefined) statusCounts[a.status] += 1
  })
  const activeCount = ACTIVE_APPLICATION_STATUSES.reduce((sum, s) => sum + statusCounts[s], 0)
  const staleCount = applications.filter(
    (a) => ACTIVE_APPLICATION_STATUSES.includes(a.status) && (daysSince(a.updatedAt) ?? 0) >= 7,
  ).length

  const signals: JobSearchSignals = {
    resumeCount: resumes.length,
    draftCount: resumes.filter((r) => r.resumeData.buildMode).length,
    variantCount: resumes.filter(
      (r) => r.resumeData.resumeKind === "jdVariant" || Boolean(r.resumeData.parentResumeId),
    ).length,
    latestResume: latest
      ? { id: latest.id, title: titleOf(latest), buildMode: Boolean(latest.resumeData.buildMode) }
      : undefined,
    applicationCount: applications.length,
    statusCounts,
    activeCount,
    staleCount,
    interviewCount: statusCounts.interview,
    offerCount: statusCounts.offer,
  }

  // 简历清单（最多 8 份，给模型可引用的 id）
  const resumeLines = sortedResumes.slice(0, 8).map((entry) => {
    const tags: string[] = []
    if (entry.resumeData.buildMode) tags.push("草稿")
    if (entry.resumeData.resumeKind === "jdVariant" || entry.resumeData.parentResumeId) tags.push("JD子版")
    const age = daysSince(entry.updatedAt)
    const ageText = age === undefined ? "" : age === 0 ? "今天更新" : `${age} 天前更新`
    return `- ${titleOf(entry)}（id=${entry.id}）${ageText}${tags.length ? ` [${tags.join("·")}]` : ""}`
  })

  const resumeBlock = resumes.length
    ? [`【用户简历】（共 ${resumes.length} 份）`, ...resumeLines].join("\n")
    : "【用户简历】用户还没有任何简历。"

  let applicationBlock: string
  if (!applications.length) {
    applicationBlock = "【投递记录】用户还没有任何投递记录。"
  } else {
    const countLine = APPLICATION_STATUS_FLOW.filter((meta) => statusCounts[meta.value] > 0)
      .map((meta) => `${meta.label} ${statusCounts[meta.value]}`)
      .join(" · ")
    applicationBlock = [
      `【投递记录】（共 ${applications.length} 个）`,
      countLine,
      `进行中 ${activeCount} 个${staleCount > 0 ? `；其中 ${staleCount} 个超过 7 天没更新，可能需要跟进` : ""}`,
    ].join("\n")
  }

  return { signals, summary: [resumeBlock, "", applicationBlock].join("\n") }
}

/** 构建求职管家的 system prompt */
export function buildCopilotSystemPrompt(summary: string): string {
  return [
    "你是「求职管家」，一款 AI-Native 求职平台的全局助理，坐在用户的简历与投递之上，统领整个求职流程。",
    "你能解读用户的简历与投递全貌，诊断求职进展，并把用户带到平台内对应的工具：简历润色、JD 匹配优化、岗位方向推荐、模拟面试、投递管理、创建简历。",
    "",
    "工作方式：",
    "1. 回答简洁、口语化、像一位贴心的求职顾问；开场先用一句话点出用户当前的求职现状。",
    "2. 基于真实状态，只推荐用户「现在最该做的一件事」（最多 2-3 个备选），不要罗列所有功能。",
    "3. 每当你建议用户去做某件事，必须调用 suggest_actions 渲染可点击的入口按钮；不要只用文字描述「你可以去 XX」。",
    "4. 针对某份具体简历的操作（润色/JD匹配/方向推荐/模拟面试/编辑），必须在 action 里带上该简历的 id（见下方简历清单）；若用户没指定，默认用最近更新的那份。",
    "5. create_resume 与 applications 不需要 resumeId。",
    "6. 你只负责「诊断 + 导航」，不直接修改简历或投递；不要声称你已经帮用户改好了什么。",
    "7. 信息不足时可以先简短追问，但不要喋喋不休。始终使用简体中文。",
    "",
    "可选的行动类型（suggest_actions.kind）：",
    "- create_resume：创建一份新简历",
    "- edit_resume：打开某份简历编辑（需 resumeId）",
    "- polish：进入某份简历的 AI 润色（需 resumeId）",
    "- jd_match：对某份简历做 JD 匹配优化（需 resumeId）",
    "- discover：基于某份简历做岗位方向推荐（需 resumeId）",
    "- interview：用某份简历做模拟面试（需 resumeId）",
    "- applications：查看投递管理看板",
    "",
    "【用户当前求职现状】",
    summary,
  ].join("\n")
}

/** 进入面板后自动发起的首条（隐藏）指令，触发开场播报 */
export const COPILOT_KICKOFF =
  "请先用一两句话总结我当前的求职现状，再推荐我现在最该做的一件事，并调用 suggest_actions 给出对应的入口按钮。"

/** suggest_actions 工具：把推荐渲染成可点击按钮 */
export const COPILOT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "suggest_actions",
      description:
        "向用户渲染 1-3 个可点击的行动按钮，把用户带到对应的求职工具。每当你建议用户去做某件事时都要调用它。",
      parameters: {
        type: "object",
        properties: {
          actions: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: {
              type: "object",
              properties: {
                kind: {
                  type: "string",
                  enum: ACTION_KINDS,
                  description: "行动类型",
                },
                label: {
                  type: "string",
                  description: "按钮文字，简短动词短语，如「润色简历」「做 JD 匹配」",
                },
                resumeId: {
                  type: "string",
                  description:
                    "针对某份简历的操作必须带上其 id（见简历清单）；create_resume / applications 不需要。",
                },
                reason: { type: "string", description: "可选：一句话推荐理由" },
              },
              required: ["kind", "label"],
            },
          },
        },
        required: ["actions"],
      },
    },
  },
]

/** 规范化模型产出的 action（过滤非法 kind、补默认文案） */
export function normalizeActions(raw: unknown): CopilotAction[] {
  if (!Array.isArray(raw)) return []
  const out: CopilotAction[] = []
  for (const item of raw) {
    const o = (item || {}) as Record<string, unknown>
    const kind = typeof o.kind === "string" ? (o.kind as CopilotActionKind) : undefined
    if (!kind || !ACTION_KINDS.includes(kind)) continue
    const needsResume = kind !== "create_resume" && kind !== "applications"
    const resumeId = typeof o.resumeId === "string" && o.resumeId ? o.resumeId : undefined
    if (needsResume && !resumeId) continue
    out.push({
      kind,
      label: typeof o.label === "string" && o.label.trim() ? o.label.trim() : COPILOT_ACTION_META[kind].label,
      resumeId,
      reason: typeof o.reason === "string" && o.reason.trim() ? o.reason.trim() : undefined,
    })
    if (out.length >= 3) break
  }
  return out
}

/** 无 API key / 出错时的确定性兜底：现状播报 + 推荐下一步 */
export function buildFallbackBriefing(signals: JobSearchSignals): { text: string; actions: CopilotAction[] } {
  const latestId = signals.latestResume?.id

  if (signals.resumeCount === 0) {
    return {
      text: "你还没有简历。我们先建一份，求职就从这里开始。",
      actions: [{ kind: "create_resume", label: "创建第一份简历" }],
    }
  }

  if (signals.applicationCount === 0 && latestId) {
    return {
      text: "你已经有简历，但还没开始投递。先看看自己适合哪些方向，再针对性优化，命中率会更高。",
      actions: [
        { kind: "discover", label: "看看适合的方向", resumeId: latestId },
        { kind: "jd_match", label: "做 JD 匹配", resumeId: latestId },
      ],
    }
  }

  if (signals.staleCount > 0 && latestId) {
    return {
      text: `有 ${signals.staleCount} 个投递超过一周没动静了，建议去跟进一下，同时复查简历与岗位的匹配度。`,
      actions: [
        { kind: "applications", label: "去跟进投递" },
        { kind: "jd_match", label: "复查匹配度", resumeId: latestId },
      ],
    }
  }

  if (signals.interviewCount > 0 && latestId) {
    return {
      text: "有岗位进入面试阶段了，先做一轮模拟面试热热身吧。",
      actions: [
        { kind: "interview", label: "开始模拟面试", resumeId: latestId },
        { kind: "applications", label: "查看投递进度" },
      ],
    }
  }

  if (signals.latestResume?.buildMode && latestId) {
    return {
      text: "你有一份还在对话创建中的简历草稿，先把它完成吧。",
      actions: [{ kind: "edit_resume", label: "继续完成简历", resumeId: latestId }],
    }
  }

  if (latestId) {
    return {
      text: "简历已经就绪。要不要让我帮你再打磨一下，或者看看适合的新方向？",
      actions: [
        { kind: "polish", label: "润色简历", resumeId: latestId },
        { kind: "discover", label: "探索新方向", resumeId: latestId },
      ],
    }
  }

  return {
    text: "我可以帮你规划求职的下一步。",
    actions: [{ kind: "create_resume", label: "创建简历" }],
  }
}

/** 悬浮按钮上的「待办」红点数：停滞投递 + 草稿 */
export function attentionCount(signals: JobSearchSignals): number {
  return signals.staleCount + signals.draftCount
}
