export function generatePdfFilename(resumeTitle: string): string {
  const base = (resumeTitle || "").trim() || "未命名"
  const encoded = base.replace(/[\x00-\x7F]/g, (ch) => {
    if (/[A-Za-z0-9\-_.~]/.test(ch)) return ch
    return encodeURIComponent(ch)
  })
  const timestamp = new Date().toISOString().slice(0, 10)

  return `简历-${encoded}-${timestamp}.pdf`
}
