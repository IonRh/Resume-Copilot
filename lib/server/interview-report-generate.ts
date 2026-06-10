import { INTERVIEW_ROUNDS, type InterviewRoundId } from "@/lib/agent/interview-rounds"
import type { PersistedAgentState } from "@/lib/agent/store"
import type { AgentTurn } from "@/lib/agent/types"
import type { OrganizedRound } from "@/lib/interview-report-organize"
import { formatOrganizedRound } from "@/lib/interview-report-organize"
import {
  assertCampaignReport,
  parseCampaignReportRaw,
  REPORT_COMPETENCY_KEYS,
  type ReportInputRound,
} from "@/lib/interview-report-parse"
import { loadAiProviderConfig } from "@/lib/server/ai-config"
import { callJsonAgent } from "@/lib/server/chat-json-agent"
import { getInterviewAgentState, listInterviewSessions } from "@/lib/server/interview-store"
import { organizeInterviewSessions } from "@/lib/server/interview-transcript-organize"
import { formatAnalysisConversation, formatInterviewerConversation } from "@/lib/interview-conversation"
import type { CampaignReportPicks, FullInterviewReport } from "@/types/interview-report"
import type { InterviewSessionRecord } from "@/types/interview-session"

const REPORT_JSON_SHAPE = JSON.stringify({
  overallScore: 75,
  overallLabel: "良好",
  summary: "总体评价段落",
  competencies: REPORT_COMPETENCY_KEYS.map((item) => ({ key: item.key, label: item.label, score: 70 })),
  rounds: [
    {
      roundId: "hr",
      roundLabel: "陈佳 · HR 面",
      score: 72,
      summary: "该轮小结",
      questions: [
        {
          segmentLabel: "核心1",
          segmentKind: "core",
          coreIndex: 1,
          question: "正式题原文",
          answer: "候选人回答",
          evaluation: "亮点与不足",
          referenceAnswer: "可复述的改进版回答",
          starRating: 3,
        },
        {
          segmentLabel: "延展1",
          segmentKind: "extension",
          coreIndex: 1,
          question: "追问原文",
          answer: "候选人回答",
          evaluation: "亮点与不足",
          referenceAnswer: "可复述的改进版回答",
          starRating: 3,
        },
      ],
    },
  ],
  suggestions: [{ title: "建议标题", description: "具体可执行说明", resources: ["可选学习资源"] }],
})

const REPORT_AGENT_SYSTEM = [
  "你是「面试报告分析师」，负责基于已整理好的模拟面试 Q&A 生成完整复盘报告。",
  "输入已是整理员输出的 segments：核心题（规划卡片）与延展追问按时间顺序排列。",
  "你不需要再解析原始对话或重新拆分题目。",
  "",
  "报告要求：",
  "1. 只输出一个 JSON 对象，不要输出 Markdown、解释、代码块或多余文字。",
  "2. competencies 必须包含且仅包含以下 6 项（key 与 label 固定，score 0-100）：",
  ...REPORT_COMPETENCY_KEYS.map((item) => `   - ${item.key} / ${item.label}`),
  "3. rounds 只覆盖输入轮次，roundId 与 roundLabel 必须与输入完全一致。",
  "4. 每轮 questions 数量、顺序须与 segments 一致；保留 segmentLabel/segmentKind/coreIndex。",
  "5. 核心题与延展分别评价；延展的 starRating 可略低于同组核心题。",
  "6. suggestions 给 3-5 条改进建议，可附推荐学习资源。",
  "7. overallLabel 必须与 overallScore 对应：优秀(>=85)、良好(70-84)、及格(60-69)、待提升(<60)。",
  `8. JSON 形状示例：${REPORT_JSON_SHAPE}`,
].join("\n")

function collectTurns(state: PersistedAgentState | null, agentSessionId?: string): AgentTurn[] {
  if (!state?.sessions?.length) return []
  const sessions = agentSessionId
    ? state.sessions.filter((session) => session.id === agentSessionId)
    : state.sessions
  return sessions.flatMap((session) => session.turns || [])
}

function normalizeCampaignReportPick(
  pick: CampaignReportPicks[InterviewRoundId] | undefined,
): { sessionId: string; agentSessionId?: string } | null {
  if (!pick) return null
  if (typeof pick === "string") return pick ? { sessionId: pick } : null
  return pick.sessionId ? pick : null
}

async function loadRoundConversation(
  record: InterviewSessionRecord,
  agentSessionId?: string,
): Promise<ReportInputRound> {
  const interviewerKey = `resume.career.interview.${record.resumeId}.${record.id}.interviewer`
  const analysisKey = `resume.career.interview.${record.resumeId}.${record.id}.analysis`

  const interviewerTurns = collectTurns(await getInterviewAgentState(interviewerKey), agentSessionId)
  const analysisTurns = collectTurns(await getInterviewAgentState(analysisKey), agentSessionId)

  return {
    roundId: record.roundId,
    roundLabel: record.roundLabel,
    interviewerLog: formatInterviewerConversation(interviewerTurns),
    analysisLog: formatAnalysisConversation(analysisTurns),
  }
}

function getCampaignSessions(campaignId: string, sessions: InterviewSessionRecord[]): InterviewSessionRecord[] {
  const map = new Map<string, InterviewSessionRecord[]>()
  for (const session of sessions) {
    const key = session.campaignId || session.id
    const bucket = map.get(key) || []
    bucket.push(session)
    map.set(key, bucket)
  }
  return map.get(campaignId) || []
}

async function buildReportInput(
  picks: CampaignReportPicks,
  campaignSessions: InterviewSessionRecord[],
): Promise<{
  title: string
  resumeTitle: string
  jobBriefing: string
  rounds: ReportInputRound[]
}> {
  const transcriptPromises = INTERVIEW_ROUNDS.map((round) => {
    const pick = normalizeCampaignReportPick(picks[round.id])
    if (!pick) return null
    const session = campaignSessions.find((item) => item.id === pick.sessionId)
    if (!session) throw new Error(`${round.label} 的会话选择已失效`)
    return loadRoundConversation(session, pick.agentSessionId)
  })
  const rounds = (await Promise.all(transcriptPromises)).filter((item): item is ReportInputRound => Boolean(item))

  if (!rounds.length) throw new Error("请至少选择一场面试记录")

  const firstSession = campaignSessions.find((item) => rounds.some((round) => item.roundId === round.roundId))
  return {
    title: firstSession?.title || "模拟面试报告",
    resumeTitle: firstSession?.resumeTitle || "未命名",
    jobBriefing: firstSession?.jobBriefing || campaignSessions[0]?.jobBriefing || "",
    rounds,
  }
}

function buildReportMessages(input: {
  title: string
  jobBriefing: string
  organizedRounds: OrganizedRound[]
}) {
  const selectedRoundIds = new Set(input.organizedRounds.map((round) => round.roundId))
  const roundOrder = INTERVIEW_ROUNDS.filter((round) => selectedRoundIds.has(round.id))
    .map((round) => `- ${round.id}: ${round.label}`)
    .join("\n")

  const userContent = [
    "请基于以下已整理的模拟面试 Q&A 生成复盘报告。",
    "",
    "【目标岗位 / 背景】",
    input.jobBriefing || input.title,
    "",
    "【轮次顺序】",
    roundOrder,
    "",
    ...input.organizedRounds.map(formatOrganizedRound),
  ].join("\n")

  return [
    { role: "system" as const, content: REPORT_AGENT_SYSTEM },
    { role: "user" as const, content: userContent },
  ]
}

export async function generateCampaignReportOnServer(args: {
  campaignId: string
  picks: CampaignReportPicks
  signal?: AbortSignal
}): Promise<FullInterviewReport> {
  const { apiKey, baseUrl, model } = await loadAiProviderConfig()
  if (!apiKey) {
    throw new Error("未配置 API Key，请在 About 页面或 .env.local 中设置后重试。")
  }

  const campaignSessions = getCampaignSessions(args.campaignId, await listInterviewSessions())
  if (!campaignSessions.length) {
    throw new Error("没有找到可复盘的面试记录")
  }

  const input = await buildReportInput(args.picks, campaignSessions)

  const organizedRounds = await organizeInterviewSessions({
    rounds: input.rounds,
    baseUrl,
    apiKey,
    model,
    signal: args.signal,
  })

  const raw = await callJsonAgent({
    baseUrl,
    apiKey,
    model,
    messages: buildReportMessages({
      title: input.title,
      jobBriefing: input.jobBriefing,
      organizedRounds,
    }),
    maxTokens: 8000,
    temperature: 0.25,
    signal: args.signal,
    errorLabel: "报告 Agent",
  })

  const report = parseCampaignReportRaw(raw, input.title)
  return assertCampaignReport(report, organizedRounds)
}
