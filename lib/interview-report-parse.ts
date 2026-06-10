import type { InterviewRoundId } from "@/lib/agent/interview-rounds"
import type { OrganizedRound } from "@/lib/interview-report-organize"
import type { FullInterviewReport } from "@/types/interview-report"

export const REPORT_COMPETENCY_KEYS = [
  { key: "basics", label: "基础知识" },
  { key: "project", label: "项目经验" },
  { key: "tools", label: "工具使用" },
  { key: "logic", label: "逻辑思维" },
  { key: "communication", label: "沟通表达" },
  { key: "business", label: "业务理解" },
] as const

export interface ReportInputRound {
  roundId: InterviewRoundId
  roundLabel: string
  interviewerLog: string
  analysisLog: string
}

export function parseCampaignReportRaw(args: Record<string, unknown>, title: string): FullInterviewReport {
  const competencies = Array.isArray(args.competencies)
    ? args.competencies.map((item, index) => {
        const row = (item || {}) as Record<string, unknown>
        return {
          key: String(row.key || `c${index}`),
          label: String(row.label || "能力项"),
          score: Number(row.score),
        }
      })
    : []

  const rounds = Array.isArray(args.rounds)
    ? args.rounds.map((item) => {
        const row = (item || {}) as Record<string, unknown>
        const questions = Array.isArray(row.questions)
          ? row.questions.map((q) => {
              const question = (q || {}) as Record<string, unknown>
              return {
                question: String(question.question || ""),
                starRating: question.starRating != null ? Number(question.starRating) : undefined,
                answer: String(question.answer || ""),
                evaluation: String(question.evaluation || ""),
                referenceAnswer: question.referenceAnswer ? String(question.referenceAnswer) : undefined,
                segmentLabel: question.segmentLabel ? String(question.segmentLabel) : undefined,
                segmentKind:
                  question.segmentKind === "core" || question.segmentKind === "extension"
                    ? question.segmentKind
                    : undefined,
                coreIndex: question.coreIndex != null ? Number(question.coreIndex) : undefined,
              }
            })
          : []
        return {
          roundId: String(row.roundId || "hr") as InterviewRoundId,
          roundLabel: String(row.roundLabel || ""),
          score: Number(row.score),
          summary: String(row.summary || ""),
          questions,
        }
      })
    : []

  const suggestions = Array.isArray(args.suggestions)
    ? args.suggestions.map((item) => {
        const row = (item || {}) as Record<string, unknown>
        return {
          title: String(row.title || ""),
          description: String(row.description || ""),
          resources: Array.isArray(row.resources) ? row.resources.map(String) : undefined,
        }
      })
    : []

  return {
    title,
    overallScore: Number(args.overallScore),
    overallLabel: String(args.overallLabel || ""),
    summary: String(args.summary || ""),
    competencies,
    rounds,
    suggestions,
  }
}

function isFiniteScore(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100
}

function overallLabelForScore(score: number): string {
  if (score >= 85) return "优秀"
  if (score >= 70) return "良好"
  if (score >= 60) return "及格"
  return "待提升"
}

export function assertCampaignReport(
  report: FullInterviewReport,
  expectedRounds: OrganizedRound[],
): FullInterviewReport {
  if (!report.summary.trim()) {
    throw new Error("报告缺少总体评价（summary）")
  }
  if (!isFiniteScore(report.overallScore)) {
    throw new Error("报告综合分无效，需为 0-100 的整数")
  }

  const expectedLabel = overallLabelForScore(report.overallScore)
  if (report.overallLabel.trim() !== expectedLabel) {
    throw new Error(`综合评级与分数不一致：${report.overallScore} 分应对应「${expectedLabel}」`)
  }

  const competencyMap = new Map(report.competencies.map((item) => [item.key, item]))
  for (const spec of REPORT_COMPETENCY_KEYS) {
    const row = competencyMap.get(spec.key)
    if (!row) throw new Error(`报告缺少能力项：${spec.key}`)
    if (row.label !== spec.label) {
      throw new Error(`能力项 ${spec.key} 的 label 应为「${spec.label}」`)
    }
    if (!isFiniteScore(row.score)) {
      throw new Error(`能力项 ${spec.key} 的 score 无效，需为 0-100`)
    }
  }
  if (report.competencies.length !== REPORT_COMPETENCY_KEYS.length) {
    throw new Error("competencies 必须且只能包含 6 项能力")
  }

  if (report.suggestions.length < 3 || report.suggestions.length > 5) {
    throw new Error("改进建议需为 3-5 条")
  }
  for (const [index, item] of report.suggestions.entries()) {
    if (!item.title.trim() || !item.description.trim()) {
      throw new Error(`第 ${index + 1} 条改进建议缺少 title 或 description`)
    }
  }

  const expectedByRound = new Map(expectedRounds.map((round) => [round.roundId, round]))
  if (report.rounds.length !== expectedRounds.length) {
    throw new Error("报告轮次数量与所选面试记录不一致")
  }

  for (const round of report.rounds) {
    const expected = expectedByRound.get(round.roundId)
    if (!expected) {
      throw new Error(`报告包含未选定的轮次：${round.roundId}`)
    }
    if (round.roundLabel !== expected.roundLabel) {
      throw new Error(`轮次 ${round.roundId} 的 roundLabel 与输入不一致`)
    }
    if (!round.summary.trim()) {
      throw new Error(`轮次 ${round.roundLabel} 缺少 summary`)
    }
    if (!isFiniteScore(round.score)) {
      throw new Error(`轮次 ${round.roundLabel} 的 score 无效，需为 0-100`)
    }
    if (round.questions.length !== expected.segments.length) {
      throw new Error(`轮次 ${round.roundLabel} 的条目数量与整理结果不一致`)
    }

    for (const [index, question] of round.questions.entries()) {
      const organized = expected.segments[index]
      if (!organized) continue
      if (!question.segmentLabel?.trim()) {
        throw new Error(`轮次 ${round.roundLabel} 第 ${index + 1} 条缺少 segmentLabel`)
      }
      if (question.segmentKind !== "core" && question.segmentKind !== "extension") {
        throw new Error(`轮次 ${round.roundLabel} 第 ${index + 1} 条缺少 segmentKind`)
      }
      if (question.segmentLabel !== organized.label) {
        throw new Error(`轮次 ${round.roundLabel} 第 ${index + 1} 条 segmentLabel 与整理结果不一致`)
      }
      if (question.segmentKind !== organized.kind) {
        throw new Error(`轮次 ${round.roundLabel} 第 ${index + 1} 条 segmentKind 与整理结果不一致`)
      }
      if (!question.question.trim()) {
        throw new Error(`轮次 ${round.roundLabel} 第 ${index + 1} 题缺少 question`)
      }
      if (!question.answer.trim()) {
        throw new Error(`轮次 ${round.roundLabel} 第 ${index + 1} 题缺少 answer`)
      }
      if (!question.evaluation.trim()) {
        throw new Error(`轮次 ${round.roundLabel} 第 ${index + 1} 题缺少 evaluation`)
      }
      if (!question.referenceAnswer?.trim()) {
        throw new Error(`轮次 ${round.roundLabel} 第 ${index + 1} 题缺少 referenceAnswer`)
      }
      if (question.starRating == null || question.starRating < 1 || question.starRating > 5) {
        throw new Error(`轮次 ${round.roundLabel} 第 ${index + 1} 题的 starRating 需为 1-5`)
      }
    }
  }

  return report
}

/** @deprecated 使用 parseCampaignReportRaw */
export const parseCampaignReportFromToolArgs = parseCampaignReportRaw
