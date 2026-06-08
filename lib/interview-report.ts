"use client"

import { INTERVIEW_ROUNDS, type InterviewRoundId } from "@/lib/agent/interview-rounds"
import type { AgentTurn, AgentCard } from "@/lib/agent/types"
import type { InterviewSessionRecord } from "@/types/interview-session"
import type {
  CampaignReportPick,
  CampaignReportPicks,
  FullInterviewReport,
  StoredCampaignReport,
} from "@/types/interview-report"
import { listInterviewSessions } from "@/lib/interview-sessions"

const REPORT_STORAGE_KEY = "interview.reports.v1"

export interface SessionExchange {
  question: string
  answer: string
  analysis?: string
}

export interface SessionTranscript {
  sessionId: string
  roundId: InterviewRoundId
  roundLabel: string
  title: string
  resumeTitle: string
  jobBriefing?: string
  exchanges: SessionExchange[]
}

type PersistedAgentState = {
  sessions?: Array<{ id?: string; title?: string; updatedAt?: string; turns?: AgentTurn[] }>
  jd?: string
}

function readAgentStorage(key: string): PersistedAgentState | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as PersistedAgentState
  } catch {
    return null
  }
}

function collectTurns(state: PersistedAgentState | null, agentSessionId?: string): AgentTurn[] {
  if (!state?.sessions?.length) return []
  const sessions = agentSessionId
    ? state.sessions.filter((session) => session.id === agentSessionId)
    : state.sessions
  return sessions.flatMap((session) => session.turns || [])
}

function extractQuestionsFromTurn(turn: AgentTurn): string[] {
  const questions: string[] = []
  for (const card of turn.cards || []) {
    const typed = card as AgentCard
    if (typed.type === "interview") {
      for (const item of typed.questions) {
        if (item.question?.trim()) questions.push(item.question.trim())
      }
    }
  }
  if (!questions.length && turn.content?.trim()) {
    questions.push(turn.content.trim())
  }
  return questions
}

function pairExchanges(questions: string[], answers: string[], analyses: string[]): SessionExchange[] {
  const size = Math.max(questions.length, answers.length)
  if (size === 0) return []
  const exchanges: SessionExchange[] = []
  for (let i = 0; i < size; i += 1) {
    exchanges.push({
      question: questions[i] || `第 ${i + 1} 题`,
      answer: answers[i] || "（未记录回答）",
      analysis: analyses[i],
    })
  }
  return exchanges
}

export interface InterviewAgentSessionOption {
  id: string
  title: string
  updatedAt?: string
  turnCount: number
}

export function listInterviewAgentSessions(record: InterviewSessionRecord): InterviewAgentSessionOption[] {
  const interviewerKey = `resume.career.interview.${record.resumeId}.${record.id}.interviewer`
  const state = readAgentStorage(interviewerKey)
  return (state?.sessions || [])
    .map((session, index) => ({
      id: session.id || `agent-session-${index}`,
      title: session.title || `第 ${index + 1} 次会话`,
      updatedAt: session.updatedAt,
      turnCount: session.turns?.length || 0,
    }))
    .filter((session) => session.turnCount > 0)
}

export function extractSessionTranscript(record: InterviewSessionRecord, agentSessionId?: string): SessionTranscript {
  const interviewerKey = `resume.career.interview.${record.resumeId}.${record.id}.interviewer`
  const analysisKey = `resume.career.interview.${record.resumeId}.${record.id}.analysis`

  const questions: string[] = []
  const answers: string[] = []
  const analyses: string[] = []

  for (const turn of collectTurns(readAgentStorage(interviewerKey), agentSessionId)) {
    if (turn.role === "assistant") {
      questions.push(...extractQuestionsFromTurn(turn))
    } else if (turn.role === "user" && turn.content?.trim()) {
      answers.push(turn.content.trim())
    }
  }

  for (const turn of collectTurns(readAgentStorage(analysisKey), agentSessionId)) {
    if (turn.role === "assistant" && turn.content?.trim()) {
      analyses.push(turn.content.trim())
    }
  }

  return {
    sessionId: record.id,
    roundId: record.roundId,
    roundLabel: record.roundLabel,
    title: record.title,
    resumeTitle: record.resumeTitle,
    jobBriefing: record.jobBriefing,
    exchanges: pairExchanges(questions, answers, analyses),
  }
}

export function groupSessionsByCampaign(sessions: InterviewSessionRecord[]): Map<string, InterviewSessionRecord[]> {
  const map = new Map<string, InterviewSessionRecord[]>()
  for (const session of sessions) {
    const campaignId = session.campaignId || session.id
    const bucket = map.get(campaignId) || []
    bucket.push(session)
    map.set(campaignId, bucket)
  }
  return map
}

export function sessionsForRound(
  campaignSessions: InterviewSessionRecord[],
  roundId: InterviewRoundId,
): InterviewSessionRecord[] {
  return campaignSessions
    .filter((item) => item.roundId === roundId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export function isCampaignReadyForReport(campaignSessions: InterviewSessionRecord[]): boolean {
  return INTERVIEW_ROUNDS.every((round) => sessionsForRound(campaignSessions, round.id).length > 0)
}

export function isPicksComplete(picks: Partial<CampaignReportPicks>): picks is CampaignReportPicks {
  return Object.values(picks).some(Boolean)
}

export function normalizeCampaignReportPick(pick: CampaignReportPick | string | undefined): CampaignReportPick | null {
  if (!pick) return null
  if (typeof pick === "string") return { sessionId: pick }
  return pick.sessionId ? pick : null
}

export function hasReportableInterview(campaignSessions: InterviewSessionRecord[]): boolean {
  return campaignSessions.some((session) => (session.questionCount || 0) > 0 || session.status !== "in_progress")
}

export function listReportReadyCampaigns(): Array<{
  campaignId: string
  title: string
  resumeTitle: string
  sessions: InterviewSessionRecord[]
}> {
  const result: Array<{ campaignId: string; title: string; resumeTitle: string; sessions: InterviewSessionRecord[] }> = []
  for (const [campaignId, sessions] of groupSessionsByCampaign(listInterviewSessions())) {
    if (!hasReportableInterview(sessions)) continue
    const latest = [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
    result.push({
      campaignId,
      title: latest.title,
      resumeTitle: latest.resumeTitle,
      sessions,
    })
  }
  return result.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"))
}

export function getCampaignSessions(campaignId: string): InterviewSessionRecord[] {
  return groupSessionsByCampaign(listInterviewSessions()).get(campaignId) || []
}

function readReports(): StoredCampaignReport[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(REPORT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredCampaignReport[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeReports(reports: StoredCampaignReport[]): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(reports.slice(0, 20)))
  } catch {
    /* ignore */
  }
}

export function getStoredCampaignReport(campaignId: string): StoredCampaignReport | undefined {
  return readReports().find((item) => item.campaignId === campaignId)
}

export function saveCampaignReport(entry: StoredCampaignReport): void {
  const reports = readReports().filter((item) => item.campaignId !== entry.campaignId)
  reports.unshift(entry)
  writeReports(reports)
}

export function buildReportInput(
  picks: CampaignReportPicks,
  campaignSessions: InterviewSessionRecord[],
): {
  title: string
  resumeTitle: string
  jobBriefing: string
  rounds: SessionTranscript[]
} {
  const transcripts = INTERVIEW_ROUNDS.map((round) => {
    const pick = normalizeCampaignReportPick(picks[round.id])
    if (!pick) return null
    const session = campaignSessions.find((item) => item.id === pick.sessionId)
    if (!session) throw new Error(`${round.label} 的会话选择已失效`)
    return extractSessionTranscript(session, pick.agentSessionId)
  }).filter((item): item is SessionTranscript => Boolean(item))

  if (!transcripts.length) throw new Error("请至少选择一场面试记录")

  const first = transcripts[0]
  return {
    title: first?.title || "模拟面试报告",
    resumeTitle: first?.resumeTitle || "未命名",
    jobBriefing: first?.jobBriefing || campaignSessions[0]?.jobBriefing || "",
    rounds: transcripts,
  }
}

export function parseCampaignReportFromToolArgs(args: Record<string, unknown>, title: string): FullInterviewReport {
  const competencies = Array.isArray(args.competencies)
    ? args.competencies.map((item, index) => {
        const row = (item || {}) as Record<string, unknown>
        return {
          key: String(row.key || `c${index}`),
          label: String(row.label || "能力项"),
          score: Number(row.score) || 0,
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
              }
            })
          : []
        return {
          roundId: String(row.roundId || "hr") as InterviewRoundId,
          roundLabel: String(row.roundLabel || ""),
          score: Number(row.score) || 0,
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
    overallScore: Number(args.overallScore) || 0,
    overallLabel: String(args.overallLabel || "待评估"),
    summary: String(args.summary || ""),
    competencies,
    rounds,
    suggestions,
  }
}
