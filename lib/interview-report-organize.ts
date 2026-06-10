import type { InterviewRoundId } from "@/lib/agent/interview-rounds"
import type { ReportInputRound } from "@/lib/interview-report-parse"

export type OrganizedSegmentKind = "core" | "extension"

export interface OrganizedSegment {
  kind: OrganizedSegmentKind
  coreIndex: number
  extensionIndex?: number
  label: string
  question: string
  answer: string
  questionKind?: string
  analysisNotes?: string
}

export interface OrganizedRound {
  roundId: InterviewRoundId
  roundLabel: string
  segments: OrganizedSegment[]
}

export const ORGANIZE_JSON_SHAPE = JSON.stringify({
  roundId: "hr",
  roundLabel: "陈佳 · HR 面",
  segments: [
    {
      kind: "core",
      coreIndex: 1,
      label: "核心1",
      questionKind: "求职动机",
      question: "正式题卡片原文",
      answer: "候选人回答",
      analysisNotes: "旁路分析要点（可选）",
    },
    {
      kind: "extension",
      coreIndex: 1,
      extensionIndex: 1,
      label: "延展1",
      question: "面试官追问原文",
      answer: "候选人回答",
    },
    {
      kind: "extension",
      coreIndex: 1,
      extensionIndex: 2,
      label: "延展2",
      question: "面试官追问原文",
      answer: "候选人回答",
    },
    {
      kind: "core",
      coreIndex: 2,
      label: "核心2",
      questionKind: "项目经验",
      question: "下一道正式题",
      answer: "候选人回答",
    },
  ],
})

export const ORGANIZE_AGENT_SYSTEM = [
  "你是「面试记录整理员」，唯一职责是把单场模拟面试的原始对话整理成「核心题 + 延展追问」的线性结构。",
  "你不评分、不写报告、不给改进建议，只做事实整理。",
  "",
  "输入说明：",
  "- `[面试官 · 正式题 X/Y]` 来自事先规划的出题卡片，对应「核心题」。",
  "- 两道正式题之间的 `[面试官]` 文本是追问，对应「延展」。",
  "- 每个 `[面试官]` / 正式题卡片后紧跟的 `[候选人]` 是对该条的回答；一一对应，不要合并不同条的回答。",
  "- `[旁路分析 #N]` 可写入对应 segment 的 analysisNotes，按出现顺序与问答对齐。",
  "",
  "输出结构（segments 数组按时间顺序扁平排列）：",
  "- 核心1 → 该核心下的延展1、延展2… → 核心2 → 该核心下的延展1…",
  "- kind=core：label 为「核心N」，coreIndex 从 1 递增；questionKind 取正式题卡片类别（如有）。",
  "- kind=extension：label 为「延展N」（N 为同一核心下的延展序号，从 1 起）；coreIndex 指向所属核心。",
  "",
  "输出要求：",
  "1. 只输出一个 JSON 对象，不要 Markdown、解释或代码块。",
  "2. roundId 与 roundLabel 必须与输入一致。",
  "3. 不要捏造对话；无回答则 answer 写「（未记录回答）」。",
  `4. JSON 形状：${ORGANIZE_JSON_SHAPE}`,
].join("\n")

function parseSegment(raw: Record<string, unknown>): OrganizedSegment {
  const kind = raw.kind === "extension" ? "extension" : "core"
  return {
    kind,
    coreIndex: Number(raw.coreIndex) || 0,
    extensionIndex: raw.extensionIndex != null ? Number(raw.extensionIndex) : undefined,
    label: String(raw.label || ""),
    question: String(raw.question || ""),
    answer: String(raw.answer || ""),
    questionKind: raw.questionKind ? String(raw.questionKind) : undefined,
    analysisNotes: raw.analysisNotes ? String(raw.analysisNotes) : undefined,
  }
}

export function parseOrganizedRoundRaw(raw: Record<string, unknown>): OrganizedRound {
  const segments = Array.isArray(raw.segments) ? raw.segments.map((item) => parseSegment((item || {}) as Record<string, unknown>)) : []
  return {
    roundId: String(raw.roundId || "hr") as InterviewRoundId,
    roundLabel: String(raw.roundLabel || ""),
    segments,
  }
}

function assertSegmentOrder(roundLabel: string, segments: OrganizedSegment[]): void {
  let currentCore = 0
  let extensionCount = 0

  for (const [index, segment] of segments.entries()) {
    const pos = `第 ${index + 1} 条`
    if (segment.kind === "core") {
      if (segment.coreIndex !== currentCore + 1) {
        throw new Error(`${roundLabel} ${pos}：核心题 coreIndex 须连续递增`)
      }
      currentCore = segment.coreIndex
      extensionCount = 0
      if (!segment.label.startsWith("核心")) {
        throw new Error(`${roundLabel} ${pos}：核心题 label 应以「核心」开头`)
      }
    } else {
      if (segment.coreIndex !== currentCore) {
        throw new Error(`${roundLabel} ${pos}：延展须紧跟所属核心题之后`)
      }
      extensionCount += 1
      if (segment.extensionIndex !== extensionCount) {
        throw new Error(`${roundLabel} ${pos}：延展序号须从 1 连续递增`)
      }
      if (!segment.label.startsWith("延展")) {
        throw new Error(`${roundLabel} ${pos}：延展 label 应以「延展」开头`)
      }
    }

    if (!segment.question.trim()) {
      throw new Error(`${roundLabel} ${pos} 缺少 question`)
    }
    if (!segment.answer.trim()) {
      throw new Error(`${roundLabel} ${pos} 缺少 answer`)
    }
  }
}

export function assertOrganizedRound(organized: OrganizedRound, expected: ReportInputRound): OrganizedRound {
  if (organized.roundId !== expected.roundId) {
    throw new Error(`整理 Agent 返回轮次 ${organized.roundId} 与预期 ${expected.roundId} 不一致`)
  }
  if (organized.roundLabel !== expected.roundLabel) {
    throw new Error(`轮次 ${expected.roundId} 的 roundLabel 与输入不一致`)
  }
  if (!organized.segments.length) {
    throw new Error(`轮次 ${expected.roundLabel} 未整理出任何问答`)
  }
  if (organized.segments[0]?.kind !== "core") {
    throw new Error(`轮次 ${expected.roundLabel} 须以核心题开头`)
  }

  assertSegmentOrder(expected.roundLabel, organized.segments)
  return organized
}

export function formatOrganizedRound(round: OrganizedRound): string {
  const lines = [`## ${round.roundLabel}`, `roundId: ${round.roundId}`, ""]
  for (const segment of round.segments) {
    const title =
      segment.kind === "core"
        ? `### ${segment.label}${segment.questionKind ? ` · ${segment.questionKind}` : ""}`
        : `### ${segment.label}（核心${segment.coreIndex}）`
    lines.push(title)
    lines.push(`问题：${segment.question}`)
    lines.push(`回答：${segment.answer}`)
    if (segment.analysisNotes?.trim()) {
      lines.push(`旁路分析：${segment.analysisNotes.trim()}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}
