import type { InterviewRoundId } from "@/lib/agent/interview-rounds"

/** 学习练手：无挂面试；真实模拟：可因不达标被终止 */
export type InterviewPlayMode = "practice" | "simulation"

export type InterviewSessionStatus = "in_progress" | "completed" | "terminated"

export interface InterviewSessionRecord {
  id: string
  /** 同一次投递模拟的多轮面试共享同一 campaignId */
  campaignId: string
  resumeId: string
  resumeTitle: string
  /** 展示用标题，如「字节跳动 · 后端开发实习」 */
  title: string
  roundId: InterviewRoundId
  /** 如「周磊 · 技术面」 */
  roundLabel: string
  /** 岗位/JD/研究等共享上下文（不含轮次头） */
  jobBriefing?: string
  briefingPreview?: string
  /** 上一轮 session id（进入下一轮时关联） */
  previousSessionId?: string
  status: InterviewSessionStatus
  /** 学习练手 / 真实模拟，默认 practice */
  playMode?: InterviewPlayMode
  /** 真实模拟下被挂面试（终止）次数 */
  failCount?: number
  questionCount?: number
  createdAt: string
  updatedAt: string
}
