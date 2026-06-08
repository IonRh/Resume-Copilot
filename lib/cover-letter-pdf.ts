import type { CoverLetterDraft } from "@/lib/agent/types"

export interface CoverLetterPrintPayload {
  title: string
  draft: CoverLetterDraft
}

export function generateCoverLetterPdfFilename(title: string): string {
  const base = (title || "").trim() || "自荐信"
  const encoded = base.replace(/[\x00-\x7F]/g, (ch) => {
    if (/[A-Za-z0-9\-_.~]/.test(ch)) return ch
    return encodeURIComponent(ch)
  })
  const timestamp = new Date().toISOString().slice(0, 10)
  return `自荐信-${encoded}-${timestamp}.pdf`
}
