import type { ResumeData } from "@/types/resume"

export interface ResumeVariantTitle {
  baseTitle: string
  label: string
}

const VARIANT_LABEL_RE = /jd|岗位|职位|定制|特化|投递|面试|公司|offer/i

export function normalizeResumeTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（(【\[].*?[）)】\]]$/g, "")
}

function cleanTitlePart(value: string): string {
  return value.trim().replace(/^[-—–｜|_:：\s]+|[-—–｜|_:：\s]+$/g, "")
}

function looksLikeVariantLabel(label: string): boolean {
  const clean = cleanTitlePart(label)
  return clean.length > 0 && clean.length <= 48 && VARIANT_LABEL_RE.test(clean)
}

export function parseResumeVariantTitle(rawTitle?: string): ResumeVariantTitle | null {
  const title = rawTitle?.trim()
  if (!title) return null

  const bracketMatch = title.match(/^(.*?)\s*[（(【\[]\s*([^（）()\[\]【】]{1,48})\s*[）)】\]]\s*$/)
  if (bracketMatch) {
    const baseTitle = cleanTitlePart(bracketMatch[1])
    const label = cleanTitlePart(bracketMatch[2])
    if (baseTitle && looksLikeVariantLabel(label)) return { baseTitle, label }
  }

  const parts = title.split(/\s*(?:[-—–｜|_:：])\s*/).map(cleanTitlePart).filter(Boolean)
  if (parts.length >= 2) {
    const label = parts.at(-1) || ""
    const baseTitle = parts.slice(0, -1).join(" - ")
    if (baseTitle && looksLikeVariantLabel(label)) return { baseTitle, label }
  }

  return null
}

export function buildJdVariantTitle(title: string, label = "岗位定制版"): string {
  const parsed = parseResumeVariantTitle(title)
  const baseTitle = parsed?.baseTitle || title.trim() || "我的简历"
  return `${baseTitle}（${label}）`
}

export function getResumeParentId(data: ResumeData): string | undefined {
  const id = data.parentResumeId?.trim()
  return id || undefined
}

export function getResumeVariantLabel(data: ResumeData): string {
  return data.variantLabel?.trim() || parseResumeVariantTitle(data.title)?.label || "JD 定制"
}

export function createJdVariantResumeData(
  source: ResumeData,
  parent: { id: string; title: string },
  title = buildJdVariantTitle(source.title),
): ResumeData {
  const now = new Date().toISOString()
  const parsed = parseResumeVariantTitle(title)
  return {
    ...source,
    title,
    parentResumeId: parent.id,
    parentResumeTitle: parent.title || source.parentResumeTitle || source.title || "未命名",
    resumeKind: "jdVariant",
    variantLabel: parsed?.label || "岗位定制版",
    createdAt: now,
    updatedAt: now,
  }
}
