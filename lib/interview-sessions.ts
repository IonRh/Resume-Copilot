"use client"

import type { InterviewSessionRecord, InterviewSessionStatus } from "@/types/interview-session"
import {
  composeInterviewBriefing,
  extractJobBriefing,
  getInterviewRound,
  getNextRound,
  resolveSessionRoundId,
  type InterviewRoundId,
} from "@/lib/agent/interview-rounds"

const STORAGE_KEY = "interview.sessions.v1"
const INTERVIEWER_STORAGE_PREFIX = "resume.career.interview."

function readAll(): InterviewSessionRecord[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as InterviewSessionRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(records: InterviewSessionRecord[]): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    /* quota / serialization errors are non-fatal */
  }
}

function interviewerStorageKey(resumeId: string, sessionId: string): string {
  return `${INTERVIEWER_STORAGE_PREFIX}${resumeId}.${sessionId}.interviewer`
}

function normalizeRecord(record: InterviewSessionRecord): InterviewSessionRecord {
  const roundId = resolveSessionRoundId(record)
  const round = getInterviewRound(roundId)!
  return {
    ...record,
    campaignId: record.campaignId || record.id,
    roundId,
    roundLabel: record.roundLabel || round.label,
  }
}

/** 从 briefing 中提取可读标题 */
export function extractInterviewTitle(briefing: string): string {
  const text = extractJobBriefing(briefing)
  if (!text) return "未命名面试"

  const firstLine = text.split(/\n/)[0]?.trim() || ""
  const cleaned = firstLine
    .replace(/^[\d.、\s*#-]+/, "")
    .replace(/\*\*/g, "")
    .trim()
  if (cleaned && cleaned.length <= 48 && !cleaned.startsWith("【")) return cleaned

  const companyMatch = text.match(/(?:公司|目标公司)[:：]\s*([^\n，,。]+)/i)
  const roleMatch = text.match(/(?:岗位|职位|方向|目标岗位)[:：]\s*([^\n，,。]+)/i)
  const company = companyMatch?.[1]?.trim()
  const role = roleMatch?.[1]?.trim()
  if (company && role) return `${company} · ${role}`
  if (company) return company
  if (role) return role

  return cleaned.slice(0, 48) || text.slice(0, 48) || "未命名面试"
}

/** 根据已持久化的面试官 Agent 状态补充进度信息 */
export function enrichSessionFromAgentStorage(record: InterviewSessionRecord): InterviewSessionRecord {
  if (typeof window === "undefined") return normalizeRecord(record)
  try {
    const raw = window.localStorage.getItem(interviewerStorageKey(record.resumeId, record.id))
    if (!raw) return normalizeRecord(record)

    const parsed = JSON.parse(raw) as {
      jd?: string
      sessions?: Array<{ turns?: Array<{ cards?: Array<{ type?: string }> }> }>
    }
    const allTurns = (parsed.sessions || []).flatMap((session) => session.turns || [])

    let questionCount = 0
    let hasReport = false
    for (const turn of allTurns) {
      for (const card of turn.cards || []) {
        if (card.type === "interview") questionCount += 1
        if (card.type === "interview_report") hasReport = true
      }
    }

    const status: InterviewSessionStatus =
      record.status === "terminated" ? "terminated" : hasReport ? "completed" : record.status
    const jobBriefing = record.jobBriefing || (parsed.jd ? extractJobBriefing(parsed.jd) : undefined)
    return normalizeRecord({
      ...record,
      status,
      questionCount: questionCount || record.questionCount,
      jobBriefing,
    })
  } catch {
    return normalizeRecord(record)
  }
}

export function listInterviewSessions(): InterviewSessionRecord[] {
  return readAll()
    .map(enrichSessionFromAgentStorage)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export function listInterviewSessionsForRound(roundId: InterviewRoundId): InterviewSessionRecord[] {
  return listInterviewSessions().filter((item) => item.roundId === roundId)
}

export function getInterviewSessionById(id: string): InterviewSessionRecord | undefined {
  return listInterviewSessions().find((item) => item.id === id)
}

export function recordInterviewTermination(sessionId: string): InterviewSessionRecord | null {
  const records = readAll()
  const index = records.findIndex((item) => item.id === sessionId)
  if (index < 0) return null
  const current = normalizeRecord(records[index])
  const next: InterviewSessionRecord = {
    ...current,
    status: "terminated",
    failCount: (current.failCount || 0) + 1,
    updatedAt: new Date().toISOString(),
  }
  records[index] = next
  writeAll(records)
  return enrichSessionFromAgentStorage(next)
}

export function upsertInterviewSession(record: InterviewSessionRecord): void {
  const normalized = normalizeRecord(record)
  const records = readAll()
  const index = records.findIndex((item) => item.id === normalized.id)
  if (index >= 0) {
    records[index] = { ...records[index], ...normalized, updatedAt: normalized.updatedAt || new Date().toISOString() }
  } else {
    records.unshift(normalized)
  }
  writeAll(records.slice(0, 100))
}

export function touchInterviewSession(id: string): void {
  const records = readAll()
  const index = records.findIndex((item) => item.id === id)
  if (index < 0) return
  records[index] = { ...records[index], updatedAt: new Date().toISOString() }
  writeAll(records)
}

export function deleteInterviewSession(id: string): void {
  writeAll(readAll().filter((item) => item.id !== id))
}

export function deleteInterviewSessionStorage(resumeId: string, sessionId: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(interviewerStorageKey(resumeId, sessionId))
    window.localStorage.removeItem(`resume.career.interview.${resumeId}.${sessionId}.analysis`)
  } catch {
    /* ignore */
  }
}

export function createNextRoundSession(parent: InterviewSessionRecord): InterviewSessionRecord | null {
  const nextRound = getNextRound(parent.roundId)
  if (!nextRound) return null

  let jobBriefing = parent.jobBriefing?.trim() || ""
  if (!jobBriefing && typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(interviewerStorageKey(parent.resumeId, parent.id))
      if (raw) {
        const parsed = JSON.parse(raw) as { jd?: string }
        if (parsed.jd) jobBriefing = extractJobBriefing(parsed.jd)
      }
    } catch {
      /* ignore */
    }
  }
  if (!jobBriefing) jobBriefing = extractJobBriefing(parent.briefingPreview || "")
  if (!jobBriefing.trim()) return null

  const sessionId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const now = new Date().toISOString()
  const briefing = composeInterviewBriefing(nextRound, jobBriefing)

  const record: InterviewSessionRecord = {
    id: sessionId,
    campaignId: parent.campaignId,
    resumeId: parent.resumeId,
    resumeTitle: parent.resumeTitle,
    title: parent.title,
    roundId: nextRound.id,
    roundLabel: nextRound.label,
    jobBriefing,
    briefingPreview: briefing.slice(0, 300),
    previousSessionId: parent.id,
    playMode: parent.playMode || "practice",
    status: "in_progress",
    createdAt: now,
    updatedAt: now,
  }

  upsertInterviewSession(record)
  return record
}

export function stashInterviewBriefing(args: {
  resumeId: string
  sessionId: string
  roundId: InterviewRoundId
  briefing: string
  playMode?: InterviewSessionRecord["playMode"]
}): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(
      "career-briefing",
      JSON.stringify({
        mode: "interview",
        resumeId: args.resumeId,
        briefing: args.briefing,
        sessionId: args.sessionId,
        roundId: args.roundId,
        playMode: args.playMode || "practice",
      }),
    )
  } catch {
    /* ignore */
  }
}
