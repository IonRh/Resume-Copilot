import type { CoverLetterDraft } from "@/lib/agent/types"
import { coverLetterToPlainText, docToText } from "@/lib/cover-letter-document"
import { generateCoverLetterPdfFilename, type CoverLetterPrintPayload } from "@/lib/cover-letter-pdf"
import {
  broadcastPdfPreviewPayload,
  createExportId,
  openPdfPreviewWithHandshake,
  stashPdfPreviewPayload,
} from "@/lib/pdf-preview-bridge"

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "自荐信"
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function buildCoverLetterPrintPayload(title: string, draft: CoverLetterDraft): CoverLetterPrintPayload {
  return { title, draft }
}

export function exportCoverLetterAsTxt(title: string, draft: CoverLetterDraft) {
  const text = coverLetterToPlainText(draft)
  if (!text) throw new Error("暂无内容可导出")
  downloadBlob(`${sanitizeFilename(title)}.txt`, new Blob([text], { type: "text/plain;charset=utf-8" }))
}

export function exportCoverLetterAsMarkdown(title: string, draft: CoverLetterDraft) {
  const body = draft.body?.trim() || docToText(draft.bodyContent)
  if (!body && !title.trim()) throw new Error("暂无内容可导出")
  const parts = [title.trim() ? `# ${title.trim()}` : "", body].filter(Boolean)
  downloadBlob(`${sanitizeFilename(title)}.md`, new Blob([parts.join("\n\n")], { type: "text/markdown;charset=utf-8" }))
}

export function exportCoverLetterAsPdf(title: string, draft: CoverLetterDraft) {
  const payload = buildCoverLetterPrintPayload(title, draft)
  const body = draft.body?.trim() || docToText(draft.bodyContent)
  if (!body && !title.trim()) throw new Error("暂无内容可导出")

  const filename = generateCoverLetterPdfFilename(title)
  const exportId = createExportId()
  stashPdfPreviewPayload(exportId, "coverLetter", payload)
  broadcastPdfPreviewPayload("coverLetter", exportId, payload)

  const path = `/pdf/preview/cover-letter/${encodeURIComponent(filename)}?export=${encodeURIComponent(exportId)}`
  const childWindow = openPdfPreviewWithHandshake(path, (child) => {
    child.postMessage({ type: "coverLetterData", data: payload }, "*")
  })
  if (!childWindow) {
    throw new Error("无法打开 PDF 预览窗口，请检查浏览器弹窗设置")
  }
}

export { generateCoverLetterPdfFilename }
