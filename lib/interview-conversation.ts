import type { AgentCard, AgentTurn } from "@/lib/agent/types"

export function formatInterviewerConversation(turns: AgentTurn[]): string {
  if (!turns.length) return "（无对话记录）"

  const lines: string[] = []
  for (const turn of turns) {
    if (turn.role === "assistant") {
      for (const card of turn.cards || []) {
        const typed = card as AgentCard
        if (typed.type !== "interview") continue
        for (const item of typed.questions) {
          if (!item.question?.trim()) continue
          const meta: string[] = []
          if (typed.currentIndex && typed.total) meta.push(`正式题 ${typed.currentIndex}/${typed.total}`)
          if (item.kind) meta.push(item.kind)
          const tag = meta.length ? `[面试官 · ${meta.join(" · ")}]` : "[面试官 · 正式题]"
          lines.push(`${tag}\n${item.question.trim()}`)
        }
      }
      if (turn.content?.trim()) {
        lines.push(`[面试官]\n${turn.content.trim()}`)
      }
      continue
    }

    if (turn.role === "user" && turn.content?.trim()) {
      lines.push(`[候选人]\n${turn.content.trim()}`)
    }
  }

  return lines.join("\n\n")
}

export function formatAnalysisConversation(turns: AgentTurn[]): string {
  const lines: string[] = []
  let index = 0
  for (const turn of turns) {
    if (turn.role !== "assistant" || !turn.content?.trim()) continue
    index += 1
    lines.push(`[旁路分析 #${index}]\n${turn.content.trim()}`)
  }
  return lines.length ? lines.join("\n\n") : "（无旁路分析）"
}

export function countCandidateReplies(conversationLog: string): number {
  return (conversationLog.match(/\[候选人\]/g) || []).length
}
