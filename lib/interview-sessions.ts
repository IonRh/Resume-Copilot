"use client"

import type { InterviewRoundHandoff, InterviewSessionRecord, InterviewSessionStatus } from "@/types/interview-session"
import {
  composeInterviewBriefing,
  extractJobBriefing,
  getInterviewRound,
  getNextRound,
  resolveSessionRoundId,
  type InterviewRoundId,
} from "@/lib/agent/interview-rounds"

const INTERVIEWER_STORAGE_PREFIX = "resume.career.interview."

function composeHandoffBriefingBlock(handoff: InterviewRoundHandoff): string {
  return [
    "【上一轮面试官交接评价】",
    `来源：${handoff.fromRoundLabel}`,
    "",
    handoff.content.trim(),
    "",
    "【下一轮使用方式】",
    "请把以上交接评价作为内部上下文：优先验证风险与疑点，避免向候选人直接透露上一轮具体评价原文。",
  ].join("\n")
}

function stripHandoffBriefingBlocks(briefing: string): string {
  const marker = "【上一轮面试官交接评价】"
  const index = briefing.indexOf(marker)
  if (index < 0) return briefing.trim()
  return briefing.slice(0, index).trim()
}

function interviewerStorageKey(resumeId: string, sessionId: string): string {
  return `${INTERVIEWER_STORAGE_PREFIX}${resumeId}.${sessionId}.interviewer`
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error || "面试记录请求失败")
  return data
}

async function readAgentStorage(key: string): Promise<{
  jd?: string
  sessions?: Array<{ turns?: Array<{ cards?: Array<{ type?: string }> }> }>
} | null> {
  if (typeof window === "undefined") return null
  const data = await requestJson<{ state?: { jd?: string; sessions?: Array<{ turns?: Array<{ cards?: Array<{ type?: string }> }> }> } | null }>(
    `/api/interviews/agent-state?key=${encodeURIComponent(key)}`,
    { cache: "no-store" },
  )
  return data.state || null
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
export async function enrichSessionFromAgentStorage(record: InterviewSessionRecord): Promise<InterviewSessionRecord> {
  if (typeof window === "undefined") return normalizeRecord(record)
  try {
    const parsed = await readAgentStorage(interviewerStorageKey(record.resumeId, record.id))
    if (!parsed) return normalizeRecord(record)
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
  throw new Error("listInterviewSessions 已迁移为异步接口，请使用 loadInterviewSessions")
}

export async function loadInterviewSessions(): Promise<InterviewSessionRecord[]> {
  const data = await requestJson<{ sessions: InterviewSessionRecord[] }>("/api/interviews", { cache: "no-store" })
  const enriched = await Promise.all((data.sessions || []).map(enrichSessionFromAgentStorage))
  return enriched.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export async function listInterviewSessionsForRound(roundId: InterviewRoundId): Promise<InterviewSessionRecord[]> {
  return (await loadInterviewSessions()).filter((item) => item.roundId === roundId)
}

export async function getInterviewSessionById(id: string): Promise<InterviewSessionRecord | undefined> {
  const data = await requestJson<{ session: InterviewSessionRecord }>(`/api/interviews/${encodeURIComponent(id)}`, { cache: "no-store" })
  return enrichSessionFromAgentStorage(data.session)
}

export async function recordInterviewTermination(sessionId: string): Promise<InterviewSessionRecord | null> {
  const data = await requestJson<{ session?: InterviewSessionRecord }>(`/api/interviews/${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "terminate" }),
  })
  return data.session ? enrichSessionFromAgentStorage(data.session) : null
}

export async function upsertInterviewSession(record: InterviewSessionRecord): Promise<InterviewSessionRecord> {
  const normalized = normalizeRecord(record)
  const data = await requestJson<{ session: InterviewSessionRecord }>("/api/interviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ record: normalized }),
  })
  return data.session
}

export async function touchInterviewSession(id: string): Promise<void> {
  await requestJson<{ session?: InterviewSessionRecord }>(`/api/interviews/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "touch" }),
  })
}

export async function deleteInterviewSession(id: string): Promise<void> {
  await requestJson<{ deleted: boolean }>(`/api/interviews/${encodeURIComponent(id)}`, { method: "DELETE" })
}

export async function deleteInterviewSessionStorage(resumeId: string, sessionId: string): Promise<void> {
  const keys = [
    interviewerStorageKey(resumeId, sessionId),
    `resume.career.interview.${resumeId}.${sessionId}.analysis`,
  ]
  await deleteInterviewAgentStateKeys(keys)
}

export async function deleteInterviewAgentStateKeys(keys: string[]): Promise<void> {
  await requestJson<{ deleted: number }>("/api/interviews/agent-state", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys }),
  })
}

export async function createNextRoundSession(
  parent: InterviewSessionRecord,
  handoff?: InterviewRoundHandoff,
): Promise<InterviewSessionRecord | null> {
  const nextRound = getNextRound(parent.roundId)
  if (!nextRound) return null

  let jobBriefing = stripHandoffBriefingBlocks(parent.jobBriefing?.trim() || "")
  if (!jobBriefing && typeof window !== "undefined") {
    try {
      const parsed = await readAgentStorage(interviewerStorageKey(parent.resumeId, parent.id))
      if (parsed?.jd) jobBriefing = extractJobBriefing(parsed.jd)
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
  const jobBriefingWithHandoff = handoff
    ? [jobBriefing, composeHandoffBriefingBlock(handoff)].filter(Boolean).join("\n\n")
    : jobBriefing
  const briefing = composeInterviewBriefing(nextRound, jobBriefingWithHandoff)

  const record: InterviewSessionRecord = {
    id: sessionId,
    campaignId: parent.campaignId,
    resumeId: parent.resumeId,
    resumeTitle: parent.resumeTitle,
    title: parent.title,
    roundId: nextRound.id,
    roundLabel: nextRound.label,
    jobBriefing: jobBriefingWithHandoff,
    briefingPreview: briefing.slice(0, 300),
    previousSessionId: parent.id,
    handoff,
    playMode: parent.playMode || "practice",
    status: "in_progress",
    createdAt: now,
    updatedAt: now,
  }

  return upsertInterviewSession(record)
}
