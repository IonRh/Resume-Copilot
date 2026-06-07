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
  /** 按钮上显示的短标签，2-8 字 */
  label: string
  /** 针对某份简历的操作需要带上其 id */
  resumeId?: string
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
    "你是「求职管家」，用户身边的求职搭子——像一位靠谱的学长/学姐，懂简历也懂投递，陪用户把求职一步步走顺。",
    "你能读懂用户的简历与投递全貌，轻轻帮用户定下一步，并把用户带到平台内对应的工具：简历润色、JD 匹配、岗位方向推荐、模拟面试、投递管理、创建简历。",
    "",
    "说话风格（很重要）：",
    "- 温暖、口语化、有人味；先共情再建议，别像系统在念报表。",
    "- 禁止堆砌数字和状态统计（如「0 个进行中、1 条已关闭」）；把数据翻译成用户能感知的阶段，例如「简历底子有了，投递还没真正动起来」。",
    "- 句子短、语气轻；可以适度用「呀」「吧」「～」，但别油、别卖萌过头。",
    "- 肯定用户已有的进展（哪怕只是「简历已经写好了」），再给下一步，让用户觉得被支持而不是被考核。",
    "- 推荐时用「我建议」「要不先…」这类商量口吻，少用「建议启动」「当前状态显示」这类公文腔。",
    "",
    "工作方式：",
    "1. 开场先打个招呼，用一两句暖心的话说说用户大概处在什么阶段；不要上来就报数。",
    "2. 基于真实状态，只推「现在最该做的一件事」（最多 2-3 个备选），别罗列所有功能。",
    "3. 每当你建议用户去做某件事，必须调用 suggest_actions 渲染可点击的入口按钮；解释和建议的话写在对话气泡里，不要写在按钮里。",
    "4. 调用 suggest_actions 之前，必须先输出 1-3 句对话气泡文字；禁止只调工具、气泡为空。",
    "5. 按钮 label 只能是 2-8 字的动词短语（如「做 JD 匹配」「看看方向」），禁止在 label 里写完整句子。",
    "6. 针对某份具体简历的操作（润色/JD匹配/方向推荐/模拟面试/编辑），必须在 action 里带上该简历的 id（见下方简历清单）；若用户没指定，默认用最近更新的那份。",
    "7. create_resume 与 applications 不需要 resumeId。",
    "8. 你只负责「陪跑 + 导航」，不直接改简历或投递；别声称已经帮用户改好了什么。",
    "9. 信息不够时可以简短追问，别喋喋不休。始终使用简体中文。",
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
  "先跟我打个招呼，用一两句暖心、口语化的话说说我现在大概什么阶段（别念数字报表），再温柔地推荐我最该做的下一步，并调用 suggest_actions 给出入口按钮。"

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
                  description: "按钮文字，2-8 字动词短语，如「润色简历」「做 JD 匹配」。禁止写完整句子。",
                },
                resumeId: {
                  type: "string",
                  description:
                    "针对某份简历的操作必须带上其 id（见简历清单）；create_resume / applications 不需要。",
                },
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
    const rawLabel = typeof o.label === "string" ? o.label.trim() : ""
    // 模型偶尔把整句写进 label，过长则回退默认短标签
    const label =
      rawLabel && rawLabel.length <= 10 ? rawLabel : COPILOT_ACTION_META[kind].label
    out.push({ kind, label, resumeId })
    if (out.length >= 3) break
  }
  return out
}

/** 无 API key / 出错时的确定性兜底：现状播报 + 推荐下一步 */
export function buildFallbackBriefing(signals: JobSearchSignals): { text: string; actions: CopilotAction[] } {
  const latestId = signals.latestResume?.id

  if (signals.resumeCount === 0) {
    return {
      text: "嗨～看起来咱们还没开始写简历呢。先把第一份搭起来，后面的方向我陪你一起捋。",
      actions: [{ kind: "create_resume", label: "创建简历" }],
    }
  }

  if (signals.applicationCount === 0 && latestId) {
    return {
      text: "简历底子已经有了，不错！投递还没真正动起来——要不先看看适合往哪些方向投？",
      actions: [
        { kind: "discover", label: "看看方向", resumeId: latestId },
        { kind: "jd_match", label: "做 JD 匹配", resumeId: latestId },
      ],
    }
  }

  if (signals.staleCount > 0 && latestId) {
    return {
      text: "有几份投递晾了一阵儿了，去跟一下进度，顺便看看简历还匹不匹配～",
      actions: [
        { kind: "applications", label: "查看投递" },
        { kind: "jd_match", label: "复查匹配", resumeId: latestId },
      ],
    }
  }

  if (signals.interviewCount > 0 && latestId) {
    return {
      text: "有面试机会啦！趁还没上战场，来练一轮模拟面试热热身吧～",
      actions: [
        { kind: "interview", label: "模拟面试", resumeId: latestId },
        { kind: "applications", label: "查看投递" },
      ],
    }
  }

  if (signals.latestResume?.buildMode && latestId) {
    return {
      text: "有一份简历还在搭架子，把它收尾完成，后面才顺～",
      actions: [{ kind: "edit_resume", label: "继续写", resumeId: latestId }],
    }
  }

  if (latestId) {
    return {
      text: "简历看着挺稳的～想再打磨打磨，还是看看有没有新方向？",
      actions: [
        { kind: "polish", label: "润色简历", resumeId: latestId },
        { kind: "discover", label: "看看方向", resumeId: latestId },
      ],
    }
  }

  return {
    text: "来啦～有什么卡住的，跟我说，我帮你理理下一步。",
    actions: [{ kind: "create_resume", label: "创建简历" }],
  }
}

/** 悬浮按钮上的「待办」红点数：停滞投递 + 草稿 */
export function attentionCount(signals: JobSearchSignals): number {
  return signals.staleCount + signals.draftCount
}
