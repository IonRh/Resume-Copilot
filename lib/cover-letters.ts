"use client"

import type { CoverLetterDraft } from "@/lib/agent/types"
import { emptyCoverLetterDoc, normalizeCoverLetterBody } from "@/lib/cover-letter-document"
import { genId } from "@/lib/resume-core/id"
import type { CoverLetterRecord } from "@/types/cover-letter"
import { coverLetterDisplayTitle } from "@/types/cover-letter"

const LEGACY_PREFIX = "resume.coverLetter."

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error || "自荐信请求失败")
  return data
}

function normalizeRecord(record: CoverLetterRecord): CoverLetterRecord {
  const normalized = normalizeCoverLetterBody(record.draft)
  const draft: CoverLetterDraft = { ...record.draft, ...normalized }
  const title = coverLetterDisplayTitle({ title: record.title, draft, resumeTitle: record.resumeTitle })
  return {
    ...record,
    title,
    draft,
    updatedAt: record.updatedAt || new Date().toISOString(),
    createdAt: record.createdAt || record.updatedAt || new Date().toISOString(),
  }
}

export async function loadCoverLetters(): Promise<CoverLetterRecord[]> {
  const data = await requestJson<{ letters: CoverLetterRecord[] }>("/api/cover-letters", { cache: "no-store" })
  return (data.letters || []).map(normalizeRecord).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )
}

export async function getCoverLetterById(id: string): Promise<CoverLetterRecord | undefined> {
  const data = await requestJson<{ letter: CoverLetterRecord }>(`/api/cover-letters/${encodeURIComponent(id)}`, {
    cache: "no-store",
  })
  return normalizeRecord(data.letter)
}

export async function saveCoverLetter(record: CoverLetterRecord): Promise<CoverLetterRecord> {
  const next = normalizeRecord({
    ...record,
    title: coverLetterDisplayTitle(record),
    updatedAt: new Date().toISOString(),
  })
  const data = await requestJson<{ letter: CoverLetterRecord }>(`/api/cover-letters/${encodeURIComponent(next.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ record: next }),
  })
  return normalizeRecord(data.letter)
}

export async function createCoverLetter(input: {
  resumeId: string
  resumeTitle: string
  draft?: CoverLetterDraft
}): Promise<CoverLetterRecord> {
  const now = new Date().toISOString()
  const emptyDraft: CoverLetterDraft = {
    title: "",
    body: "",
    bodyContent: emptyCoverLetterDoc(),
    scenario: "general",
    highlights: [],
    shortVersion: "",
  }

  const draft = input.draft
    ? { ...emptyDraft, ...input.draft, ...normalizeCoverLetterBody(input.draft) }
    : emptyDraft

  const record: CoverLetterRecord = {
    id: genId("cl"),
    resumeId: input.resumeId,
    resumeTitle: input.resumeTitle,
    title: `${input.resumeTitle} · 自荐信`,
    draft,
    createdAt: now,
    updatedAt: now,
  }

  const data = await requestJson<{ letter: CoverLetterRecord }>("/api/cover-letters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ record: normalizeRecord(record) }),
  })
  return normalizeRecord(data.letter)
}

export async function deleteCoverLetterRecord(id: string): Promise<void> {
  await requestJson<{ deleted: boolean }>(`/api/cover-letters/${encodeURIComponent(id)}`, { method: "DELETE" })
}

/** 将旧版 localStorage 草稿迁移到服务端记录 */
export async function migrateLegacyCoverLetters(resumeTitles: Record<string, string>): Promise<number> {
  if (typeof window === "undefined") return 0

  const existing = await loadCoverLetters()
  const migratedResumeIds = new Set(existing.map((item) => item.resumeId))
  let count = 0

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (!key?.startsWith(LEGACY_PREFIX)) continue

    const resumeId = key.slice(LEGACY_PREFIX.length)
    if (!resumeId || migratedResumeIds.has(resumeId)) continue

    try {
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as CoverLetterDraft
      const normalized = normalizeCoverLetterBody(parsed)
      const draft = { ...parsed, ...normalized }
      const hasContent = Boolean(draft.title?.trim() || draft.body?.trim() || draft.bodyContent?.content?.length)
      if (!hasContent) continue

      await createCoverLetter({
        resumeId,
        resumeTitle: resumeTitles[resumeId] || "未命名简历",
        draft,
      })
      window.localStorage.removeItem(key)
      migratedResumeIds.add(resumeId)
      count += 1
    } catch {
      /* ignore broken legacy entries */
    }
  }

  return count
}

export function hasCoverLetterBody(draft: CoverLetterDraft): boolean {
  return Boolean(
    draft.body?.trim() ||
      draft.bodyContent?.content?.some((block) =>
        block.content?.some((node) => typeof node.text === "string" && node.text.trim().length > 0),
      ),
  )
}
