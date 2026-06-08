import type { ResumeData } from "@/types/resume"
import { normalizeResumeData } from "./normalize"

export async function toDataUrlIfRemote(url?: string): Promise<string | undefined> {
  if (!url) return undefined
  if (/^data:/i.test(url)) return url
  if (/^blob:/i.test(url)) return undefined
  if (!/^https?:\/\//i.test(url)) return url
  try {
    const res = await fetch(url)
    if (!res.ok) return url
    const contentType = res.headers.get("content-type") || "application/octet-stream"
    const buffer = Buffer.from(await res.arrayBuffer())
    return `data:${contentType};base64,${buffer.toString("base64")}`
  } catch {
    return url
  }
}

export async function prepareResumeDataForPdf(data: ResumeData): Promise<ResumeData> {
  const preparedData = normalizeResumeData(data)
  if (preparedData.avatar) {
    preparedData.avatar = await toDataUrlIfRemote(preparedData.avatar)
  }
  return preparedData
}
