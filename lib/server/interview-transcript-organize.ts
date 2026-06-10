import {
  assertOrganizedRound,
  ORGANIZE_AGENT_SYSTEM,
  parseOrganizedRoundRaw,
  type OrganizedRound,
} from "@/lib/interview-report-organize"
import type { ReportInputRound } from "@/lib/interview-report-parse"
import { callJsonAgent } from "@/lib/server/chat-json-agent"

function formatSessionLog(round: ReportInputRound): string {
  return [
    `roundId: ${round.roundId}`,
    `roundLabel: ${round.roundLabel}`,
    "",
    "### 原始面试对话",
    round.interviewerLog,
    "",
    "### 旁路分析记录",
    round.analysisLog,
  ].join("\n")
}

function buildOrganizeMessages(round: ReportInputRound) {
  const userContent = [
    "请整理以下单场模拟面试记录，输出核心题 + 延展追问的 segments 结构。",
    "",
    formatSessionLog(round),
  ].join("\n")

  return [
    { role: "system" as const, content: ORGANIZE_AGENT_SYSTEM },
    { role: "user" as const, content: userContent },
  ]
}

export async function organizeInterviewSession(args: {
  round: ReportInputRound
  baseUrl: string
  apiKey: string
  model: string
  signal?: AbortSignal
}): Promise<OrganizedRound> {
  const raw = await callJsonAgent({
    baseUrl: args.baseUrl,
    apiKey: args.apiKey,
    model: args.model,
    messages: buildOrganizeMessages(args.round),
    maxTokens: 6000,
    temperature: 0.2,
    signal: args.signal,
    errorLabel: `整理 Agent（${args.round.roundLabel}）`,
  })

  return assertOrganizedRound(parseOrganizedRoundRaw(raw), args.round)
}

/** 每个会话独立跑整理 Agent，并发执行 */
export async function organizeInterviewSessions(args: {
  rounds: ReportInputRound[]
  baseUrl: string
  apiKey: string
  model: string
  signal?: AbortSignal
}): Promise<OrganizedRound[]> {
  return Promise.all(
    args.rounds.map((round) =>
      organizeInterviewSession({
        round,
        baseUrl: args.baseUrl,
        apiKey: args.apiKey,
        model: args.model,
        signal: args.signal,
      }),
    ),
  )
}
