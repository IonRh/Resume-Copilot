"use client"
// Copyright (c) 2025 wzdnzd
// SPDX-License-Identifier: MIT

import type { ResumeData, StoredResume } from "@/types/resume"
import { LOCAL_STORAGE_KEY } from "@/types/resume"
import { getResumeDisplayName } from "@/lib/resume-display"

const EDIT_PREFETCH_PREFIX = "resume.edit.prefetch."
const RESUME_LIST_CACHE_KEY = "resume.list.cache.v1"

// 进程内缓存：同一次会话内立即拿到上次结果，避免每次都白屏等网络
let resumeListCache: StoredResume[] | null = null

function readSessionCache(): StoredResume[] | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(RESUME_LIST_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredResume[]
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeResumeListCache(list: StoredResume[]): void {
  resumeListCache = list
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(RESUME_LIST_CACHE_KEY, JSON.stringify(list))
  } catch {
    /* 配额不足或不可用时忽略，仅丢失加速缓存 */
  }
}

// 同步读取已缓存的简历列表，供首屏立即渲染（stale-while-revalidate）
export function getCachedResumes(): StoredResume[] | null {
  if (resumeListCache) return resumeListCache
  const fromSession = readSessionCache()
  if (fromSession) resumeListCache = fromSession
  return fromSession
}

export type StorageErrorCode =
  | "UNAVAILABLE"
  | "PARSE_ERROR"
  | "QUOTA_EXCEEDED"
  | "UNAUTHORIZED"
  | "UNKNOWN"

export class StorageError extends Error {
  code: StorageErrorCode
  constructor(message: string, code: StorageErrorCode = "UNKNOWN") {
    super(message)
    this.code = code
    this.name = "StorageError"
  }
}

async function readPayload<T>(res: Response): Promise<T> {
  const payload = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    const code: StorageErrorCode = res.status === 401 ? "UNAUTHORIZED" : "UNKNOWN"
    throw new StorageError(payload.error || `后台请求失败：${res.status}`, code)
  }
  return payload
}

async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(input, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : undefined),
        ...init?.headers,
      },
      cache: "no-store",
    })
  } catch (error) {
    throw new StorageError(error instanceof Error ? error.message : "无法连接后台存储", "UNAVAILABLE")
  }
  return readPayload<T>(res)
}

function readLegacyLocalResumes(): StoredResume[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredResume[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function migrateLegacyLocalResumes(): Promise<StoredResume[]> {
  const legacy = readLegacyLocalResumes()
  if (legacy.length === 0) return []

  const migrated: StoredResume[] = []
  for (const entry of legacy) {
    if (!entry?.resumeData) continue
    migrated.push(await createEntryFromData(entry.resumeData, getResumeDisplayName(entry)))
  }

  if (migrated.length > 0 && typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY)
    } catch {
      /* ignore cleanup failure */
    }
  }
  return migrated
}

export async function getAllResumes(): Promise<StoredResume[]> {
  const payload = await request<{ resumes: StoredResume[] }>("/api/resumes")
  if (payload.resumes.length > 0) {
    writeResumeListCache(payload.resumes)
    return payload.resumes
  }
  const migrated = await migrateLegacyLocalResumes()
  const result = migrated.length > 0 ? migrated : payload.resumes
  writeResumeListCache(result)
  return result
}

export async function getResumeById(id: string): Promise<StoredResume | null> {
  try {
    const payload = await request<{ resume: StoredResume }>(`/api/resumes/${encodeURIComponent(id)}`)
    return payload.resume
  } catch (error) {
    if (error instanceof StorageError && error.message.includes("未找到")) return null
    throw error
  }
}

export async function createEntryFromData(data: ResumeData, displayName?: string): Promise<StoredResume> {
  const payload = await request<{ resume: StoredResume }>("/api/resumes", {
    method: "POST",
    body: JSON.stringify({ resumeData: data, displayName }),
  })
  return payload.resume
}

export async function updateEntryData(id: string, data: ResumeData, displayName?: string): Promise<StoredResume> {
  const payload = await request<{ resume: StoredResume }>(`/api/resumes/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ resumeData: data, displayName }),
  })
  return payload.resume
}

export async function updateEntryDisplayName(id: string, displayName: string): Promise<StoredResume> {
  const payload = await request<{ resume: StoredResume }>(`/api/resumes/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ displayName }),
  })
  return payload.resume
}

export async function deleteResumes(ids: string[]): Promise<void> {
  await request<{ deleted: number }>("/api/resumes", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  })
}

async function loadTemplate(type: "default" | "example"): Promise<ResumeData | null> {
  try {
    const payload = await request<{ resumeData: ResumeData }>(`/api/resumes/template?type=${type}`)
    return payload.resumeData
  } catch {
    return null
  }
}

export function loadDefaultTemplate(): Promise<ResumeData | null> {
  return loadTemplate("default")
}

export function loadExampleTemplate(): Promise<ResumeData | null> {
  return loadTemplate("example")
}

export function stashResumeForEdit(entry: StoredResume): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(`${EDIT_PREFETCH_PREFIX}${entry.id}`, JSON.stringify(entry))
  } catch {
    /* ignore prefetch failure */
  }
}

export function takeStashedResumeForEdit(id: string): StoredResume | null {
  if (typeof window === "undefined") return null
  const key = `${EDIT_PREFETCH_PREFIX}${id}`
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredResume
    return parsed?.id === id && parsed.resumeData ? parsed : null
  } catch {
    try {
      window.sessionStorage.removeItem(key)
    } catch {
      /* ignore cleanup failure */
    }
    return null
  }
}

export function clearStashedResumeForEdit(id: string): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.removeItem(`${EDIT_PREFETCH_PREFIX}${id}`)
  } catch {
    /* ignore cleanup failure */
  }
}
