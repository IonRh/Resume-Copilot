"use client"

import { streamChat } from "@/lib/agent/stream"
import type { ChatMessage } from "@/lib/agent/types"
import type { InterviewSessionRecord, InterviewRoundHandoff } from "@/types/interview-session"
import { extractSessionTranscript, type SessionTranscript } from "@/lib/interview-report"

const HANDOFF_STORAGE_KEY = "interview.handoffs.v1"

type StoredHandoff = InterviewRoundHandoff

function readHandoffs(): StoredHandoff[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(HANDOFF_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredHandoff[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeHandoffs(items: StoredHandoff[]): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify(items.slice(0, 100)))
  } catch {
    /* ignore */
  }
}

export function getStoredRoundHandoff(sessionId: string): InterviewRoundHandoff | undefined {
  return readHandoffs().find((item) => item.fromSessionId === sessionId)
}

export function deleteStoredRoundHandoff(sessionId: string): void {
  writeHandoffs(readHandoffs().filter((item) => item.fromSessionId !== sessionId))
}

export function saveRoundHandoff(handoff: InterviewRoundHandoff): void {
  const rest = readHandoffs().filter((item) => item.fromSessionId !== handoff.fromSessionId)
  writeHandoffs([handoff, ...rest])
}

function formatTranscriptForHandoff(transcript: SessionTranscript): string {
  if (!transcript.exchanges.length) return "（未读取到完整问答记录）"
  return transcript.exchanges
    .map((item, index) => {
      const parts = [`### 第 ${index + 1} 题`, `问题：${item.question}`, `回答：${item.answer}`]
      if (item.analysis) parts.push(`旁路分析：${item.analysis}`)
      return parts.join("\n")
    })
    .join("\n\n")
}

function fallbackHandoff(record: InterviewSessionRecord, transcript: SessionTranscript): string {
  const answered = transcript.exchanges.filter((item) => item.answer && item.answer !== "（未记录回答）").length
  return [
    `## ${record.roundLabel} 交接评价`,
    "",
    "### 结论",
    answered > 0
      ? `本轮已完成 ${answered} 组问答，可以进入下一轮继续验证。`
      : "本轮暂未读取到完整回答记录，下一轮需要先补充验证候选人的真实能力。",
    "",
    "### 已观察到的信号",
    "- 候选人已完成本轮模拟流程。",
    "- 具体强弱项需要下一轮面试官结合候选人回答继续确认。",
    "",
    "### 下一轮待验证",
    "- 追问候选人在关键经历中的个人贡献边界。",
    "- 要求候选人补充可量化结果、约束条件和取舍理由。",
    "- 若回答仍偏空泛，优先验证项目真实性和岗位核心能力。",
  ].join("\n")
}

export async function generateRoundHandoff(args: {
  session: InterviewSessionRecord
  agentSessionId?: string
  signal?: AbortSignal
}): Promise<InterviewRoundHandoff> {
  const transcript = extractSessionTranscript(args.session, args.agentSessionId)
  const system = [
    "你是企业招聘流程里的面试交接评审人。",
    "你要基于上一轮模拟面试记录，生成给下一轮面试官看的内部交接评价。",
    "这不是写给候选人的辅导建议，不要寒暄，不要安慰，不要输出参考答案。",
    "重点是：是否建议进入下一轮、上一轮观察到的优势、风险点、下一轮必须验证的问题、建议追问。",
    "请用简体中文，Markdown 输出，控制在 450 字以内。",
  ].join("\n")

  const user = [
    `【上一轮】${args.session.roundLabel}`,
    `【岗位/背景】${args.session.jobBriefing || args.session.briefingPreview || args.session.title}`,
    "",
    "【上一轮问答记录】",
    formatTranscriptForHandoff(transcript),
    "",
    "请按以下结构输出：",
    "## 交接结论",
    "### 通过/风险判断",
    "### 亮点证据",
    "### 风险与疑点",
    "### 下一轮待验证",
    "### 建议追问",
  ].join("\n")

  let content = ""
  try {
    const result = await streamChat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ] satisfies ChatMessage[],
      { useTools: false, maxTokens: 1100 },
      args.signal || new AbortController().signal,
      () => {},
    )
    content = result.content.trim()
  } catch {
    content = fallbackHandoff(args.session, transcript)
  }

  const handoff: InterviewRoundHandoff = {
    fromSessionId: args.agentSessionId ? `${args.session.id}:${args.agentSessionId}` : args.session.id,
    fromRoundId: args.session.roundId,
    fromRoundLabel: args.session.roundLabel,
    generatedAt: new Date().toISOString(),
    content: content || fallbackHandoff(args.session, transcript),
  }
  saveRoundHandoff(handoff)
  return handoff
}
