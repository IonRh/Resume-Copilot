"use client"

import type { JobApplication } from "@/types/application"
import { StorageError, type StorageErrorCode } from "@/lib/storage"

/** 创建/更新投递记录时提交的字段（服务端会补齐 id 与时间戳） */
export type ApplicationDraft = Partial<Omit<JobApplication, "id" | "createdAt" | "updatedAt">>

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

export async function getAllApplications(): Promise<JobApplication[]> {
  const payload = await request<{ applications: JobApplication[] }>("/api/applications")
  return payload.applications
}

export async function createApplication(draft: ApplicationDraft): Promise<JobApplication> {
  const payload = await request<{ application: JobApplication }>("/api/applications", {
    method: "POST",
    body: JSON.stringify({ application: draft }),
  })
  return payload.application
}

export async function updateApplication(id: string, draft: ApplicationDraft): Promise<JobApplication> {
  const payload = await request<{ application: JobApplication }>(`/api/applications/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ application: draft }),
  })
  return payload.application
}

export async function deleteApplications(ids: string[]): Promise<void> {
  await request<{ deleted: number }>("/api/applications", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  })
}
