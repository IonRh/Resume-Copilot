import type { AgentTurn } from "@/lib/agent/types"

export interface AnalysisFeedItem {
  turnId: string
  round: number
  title: string
  preview: string
  score?: string
  streaming: boolean
  error?: boolean
  content: string
}

/** 由右侧面试作答触发的自动分析（非模态框追问） */
export function isPrimaryAnalysisTrigger(turn: AgentTurn): boolean {
  if (turn.role !== "user") return false
  const text = turn.content
  return text.includes("正在分析这一轮表现") || text.includes("请分析这一轮模拟面试回答")
}

/** 从会话中提取每轮主分析卡片（不含追问回复） */
export function buildAnalysisFeedItems(turns: AgentTurn[]): AnalysisFeedItem[] {
  const items: AnalysisFeedItem[] = []
  let round = 0

  for (let i = 0; i < turns.length; i++) {
    if (!isPrimaryAnalysisTrigger(turns[i])) continue
    const assistant = turns[i + 1]
    if (!assistant || assistant.role !== "assistant") continue

    round += 1
    const content = assistant.content.trim()
    items.push({
      turnId: assistant.id,
      round,
      title: `第 ${round} 轮分析`,
      preview: extractPreview(content),
      score: extractScore(content),
      streaming: Boolean(assistant.streaming),
      error: assistant.error,
      content,
    })
  }

  return items
}

/** 某轮分析之后的追问线程，直到下一轮主分析 */
export function getFollowUpThread(turns: AgentTurn[], rootAssistantId: string): AgentTurn[] {
  const rootIdx = turns.findIndex((t) => t.id === rootAssistantId)
  if (rootIdx < 0) return []

  const thread: AgentTurn[] = []
  for (let i = rootIdx + 1; i < turns.length; i++) {
    if (isPrimaryAnalysisTrigger(turns[i])) break
    thread.push(turns[i])
  }
  return thread
}

function extractScore(content: string): string | undefined {
  if (!content) return undefined
  const patterns = [
    /单题评分[：:]\s*(\d+(?:\.\d+)?(?:\s*\/\s*10)?)/,
    /(?:评分|得分)[：:]\s*(\d+(?:\.\d+)?(?:\s*\/\s*10)?)/,
    /(\d+(?:\.\d+)?)\s*\/\s*10/,
    /(\d{1,3})\s*分(?!\s*钟)/,
  ]
  for (const pattern of patterns) {
    const match = content.match(pattern)
    if (match?.[1]) return match[1].includes("/") ? match[1] : `${match[1]}分`
  }
  return undefined
}

function extractPreview(content: string): string {
  if (!content) return "分析完成后可查看详细评价"

  const sectionPatterns = [
    /主要问题[：:\s]*([^\n#]+)/,
    /回答亮点[：:\s]*([^\n#]+)/,
    /不足[：:\s]*([^\n#]+)/,
  ]
  for (const pattern of sectionPatterns) {
    const match = content.match(pattern)
    if (match?.[1]?.trim()) return truncate(stripMarkdown(match[1].trim()), 72)
  }

  const plain = stripMarkdown(content)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  return truncate(plain[0] || "点击查看完整评价", 72)
}

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .trim()
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}
