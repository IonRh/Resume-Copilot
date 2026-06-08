import type { StoredResume } from "@/types/resume"

export function getResumeDisplayName(entry: StoredResume | null | undefined): string {
  return entry?.displayName?.trim() || entry?.resumeData?.title?.trim() || "未命名"
}

export function getResumeStoredName(entry: StoredResume | null | undefined): string {
  return entry?.resumeData?.title?.trim() || "未命名"
}

export function sanitizeResumeDisplayName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const name = value.trim()
  return name || undefined
}
