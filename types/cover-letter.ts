import type { CoverLetterDraft } from "@/lib/agent/types"

export interface CoverLetterRecord {
  id: string
  resumeId: string
  resumeTitle: string
  /** 列表展示用标题 */
  title: string
  draft: CoverLetterDraft
  createdAt: string
  updatedAt: string
}

export function coverLetterDisplayTitle(record: Pick<CoverLetterRecord, "title" | "draft" | "resumeTitle">): string {
  const fromDraft = record.draft.title?.trim()
  if (fromDraft) return fromDraft
  if (record.title.trim()) return record.title.trim()
  return `${record.resumeTitle || "未命名简历"} · 自荐信`
}

export function coverLetterScenarioLabel(scenario?: CoverLetterDraft["scenario"]): string {
  switch (scenario) {
    case "formal":
      return "正式求职信"
    case "short":
      return "简短开场"
    case "referral":
      return "内推说明"
    default:
      return "通用版本"
  }
}
