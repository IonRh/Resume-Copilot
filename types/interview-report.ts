import type { InterviewRoundId } from "@/lib/agent/interview-rounds"

export interface ReportCompetency {
  key: string
  label: string
  score: number
}

export interface ReportQuestionItem {
  question: string
  starRating?: number
  answer: string
  evaluation: string
  referenceAnswer?: string
}

export interface ReportRoundSection {
  roundId: InterviewRoundId
  roundLabel: string
  score: number
  summary: string
  questions: ReportQuestionItem[]
}

export interface ReportSuggestion {
  title: string
  description: string
  resources?: string[]
}

export interface FullInterviewReport {
  title: string
  overallScore: number
  overallLabel: string
  summary: string
  competencies: ReportCompetency[]
  rounds: ReportRoundSection[]
  suggestions: ReportSuggestion[]
}

export interface CampaignReportPick {
  sessionId: string
  agentSessionId?: string
}

export type CampaignReportPicks = Partial<Record<InterviewRoundId, CampaignReportPick | string>>

export interface StoredCampaignReport {
  campaignId: string
  title: string
  resumeTitle: string
  generatedAt: string
  picks: CampaignReportPicks
  report: FullInterviewReport
}
