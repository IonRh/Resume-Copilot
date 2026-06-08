import { CAMPAIGN_REPORT_TOOL } from "@/lib/agent/tool-schemas"
import { streamChat } from "@/lib/agent/stream"
import type { ChatMessage } from "@/lib/agent/types"
import { INTERVIEW_ROUNDS } from "@/lib/agent/interview-rounds"
import { buildReportInput, parseCampaignReportFromToolArgs, type SessionTranscript } from "@/lib/interview-report"
import type { CampaignReportPicks, FullInterviewReport } from "@/types/interview-report"
import type { InterviewSessionRecord } from "@/types/interview-session"

const REPORT_AGENT_SYSTEM = [
  "你是「面试报告分析师」，负责把用户选定的模拟面试记录整理成一份完整、可展示的复盘报告。",
  "你会收到一轮或多轮面试的问答与分析记录，以及目标岗位背景。",
  "",
  "工作要求：",
  "1. 仔细阅读每一轮的用户回答与已有分析，给出客观、具体、可行动的评价。",
  "2. 必须调用 present_campaign_report 一次性输出完整报告，不要输出大段自由文本。",
  "3. competencies 必须包含且仅包含以下 6 项（key 固定，score 0-100）：",
  "   - basics / 基础知识",
  "   - project / 项目经验",
  "   - tools / 工具使用",
  "   - logic / 逻辑思维",
  "   - communication / 沟通表达",
  "   - business / 业务理解",
  "4. rounds 只覆盖用户实际选定的轮次，roundId 必须与输入记录保持一致。",
  "5. 每轮 questions 需保留用户原回答要点，evaluation 要指出亮点与不足；referenceAnswer 给可复述的改进版。",
  "6. starRating 为 1-5 星，与回答质量对应。",
  "7. suggestions 给 3-5 条改进建议，可附推荐学习资源。",
  "8. overallLabel 使用：优秀(>=85)、良好(70-84)、及格(60-69)、待提升(<60)。",
].join("\n")

function formatTranscript(round: SessionTranscript): string {
  const lines = [
    `## ${round.roundLabel}`,
    `会话 ID：${round.sessionId}`,
    "",
  ]
  round.exchanges.forEach((item, index) => {
    lines.push(`### 第 ${index + 1} 题`)
    lines.push(`问题：${item.question}`)
    lines.push(`回答：${item.answer}`)
    if (item.analysis) {
      lines.push(`已有分析：${item.analysis}`)
    }
    lines.push("")
  })
  return lines.join("\n")
}

export async function generateCampaignReport(args: {
  picks: CampaignReportPicks
  campaignSessions: InterviewSessionRecord[]
  signal?: AbortSignal
}): Promise<FullInterviewReport> {
  const input = await buildReportInput(args.picks, args.campaignSessions)
  const selectedRoundIds = new Set(input.rounds.map((round) => round.roundId))
  const roundOrder = INTERVIEW_ROUNDS
    .filter((round) => selectedRoundIds.has(round.id))
    .map((round) => `- ${round.id}: ${round.label}`)
    .join("\n")

  const userContent = [
    "请基于以下模拟面试记录生成复盘报告。",
    "",
    `【目标岗位 / 背景】`,
    input.jobBriefing || input.title,
    "",
    `【轮次顺序】`,
    roundOrder,
    "",
    ...input.rounds.map(formatTranscript),
  ].join("\n")

  const messages: ChatMessage[] = [
    { role: "system", content: REPORT_AGENT_SYSTEM },
    { role: "user", content: userContent },
  ]

  const { toolCalls } = await streamChat(
    messages,
    { tools: [CAMPAIGN_REPORT_TOOL], toolChoice: "required", maxTokens: 8000 },
    args.signal || new AbortController().signal,
    () => {},
  )

  const reportCall = toolCalls.find((call) => call.function.name === "present_campaign_report")
  if (!reportCall) {
    throw new Error("报告 Agent 未返回 present_campaign_report")
  }

  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(reportCall.function.arguments || "{}") as Record<string, unknown>
  } catch {
    throw new Error("报告 Agent 返回格式无效")
  }

  return parseCampaignReportFromToolArgs(parsed, input.title)
}
