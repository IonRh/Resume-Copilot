"use client"

import type { JobApplication } from "@/types/application"
import type { ResumeData } from "@/types/resume"
import { StorageError, type StorageErrorCode } from "@/lib/storage"
import type { ApplicationInsightsReport } from "@/app/api/applications/insights/route"
import type { ApplicationAssistResult } from "@/app/api/applications/assist/route"

export type { ApplicationInsightsReport, ApplicationAssistResult }

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    })
  } catch (error) {
    throw new StorageError(error instanceof Error ? error.message : "无法连接服务", "UNAVAILABLE")
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    const code: StorageErrorCode = res.status === 401 ? "UNAUTHORIZED" : "UNKNOWN"
    throw new StorageError(data.error || `请求失败：${res.status}`, code)
  }
  return data
}

function ageDays(iso?: string): number | undefined {
  if (!iso) return undefined
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return undefined
  return Math.max(0, Math.round((Date.now() - t) / 86400000))
}

export function fetchApplicationInsights(applications: JobApplication[]): Promise<ApplicationInsightsReport> {
  const summaries = applications.map((a) => ({
    company: a.company,
    position: a.position,
    channel: a.channel,
    status: a.status,
    priority: a.priority,
    appliedAt: a.appliedAt,
    ageDays: ageDays(a.appliedAt || a.createdAt),
    resumeTitle: a.resumeTitle,
    nextAction: a.nextAction,
  }))
  return postJson<ApplicationInsightsReport>("/api/applications/insights", { applications: summaries })
}

export function fetchApplicationAssist(
  application: JobApplication,
  resumeData?: ResumeData,
): Promise<ApplicationAssistResult> {
  return postJson<ApplicationAssistResult>("/api/applications/assist", {
    application: {
      company: application.company,
      position: application.position,
      status: application.status,
      channel: application.channel,
      appliedAt: application.appliedAt,
      ageDays: ageDays(application.appliedAt || application.createdAt),
      nextAction: application.nextAction,
      jdText: application.jdText,
      jdUrl: application.jdUrl,
      notes: application.notes,
      resumeTitle: application.resumeTitle,
    },
    resumeData,
  })
}
