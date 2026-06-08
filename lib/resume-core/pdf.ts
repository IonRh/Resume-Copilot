import type { ResumeData } from "@/types/resume"
import { normalizeResumeData } from "./normalize"

type InlineOptions = {
  origin?: string
}

function resolveFetchUrl(url: string, origin?: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith("//")) return `https:${trimmed}`
  if (trimmed.startsWith("/")) {
    if (!origin) return null
    return `${origin.replace(/\/$/, "")}${trimmed}`
  }
  if (origin) {
    try {
      return new URL(trimmed, origin).toString()
    } catch {
      return null
    }
  }
  return null
}

async function fetchAsDataUrl(fetchUrl: string): Promise<string | undefined> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(fetchUrl, { signal: controller.signal })
    if (!res.ok) return undefined
    const contentType = res.headers.get("content-type") || "application/octet-stream"
    const buffer = Buffer.from(await res.arrayBuffer())
    return `data:${contentType};base64,${buffer.toString("base64")}`
  } catch {
    return undefined
  } finally {
    clearTimeout(timeout)
  }
}

export async function toDataUrlIfRemote(url?: string, options?: InlineOptions): Promise<string | undefined> {
  if (!url) return undefined
  const trimmed = url.trim()
  if (!trimmed) return undefined
  if (/^data:/i.test(trimmed)) return trimmed
  if (/^blob:/i.test(trimmed)) return undefined

  const fetchUrl = resolveFetchUrl(trimmed, options?.origin)
  if (fetchUrl) {
    const inlined = await fetchAsDataUrl(fetchUrl)
    if (inlined) return inlined
    return trimmed
  }

  return trimmed
}

export async function prepareResumeDataForPdf(data: ResumeData, origin?: string): Promise<ResumeData> {
  const preparedData = normalizeResumeData(data)
  if (preparedData.avatar) {
    preparedData.avatar = await toDataUrlIfRemote(preparedData.avatar, { origin })
  }
  return preparedData
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Browser-side: inline avatar before passing resume data to the PDF preview window. */
export async function prepareResumeDataForClientExport(data: ResumeData): Promise<ResumeData> {
  const prepared = normalizeResumeData(data)
  const avatar = prepared.avatar?.trim()
  if (!avatar) return prepared

  if (/^data:/i.test(avatar)) return prepared

  try {
    if (/^blob:/i.test(avatar)) {
      const res = await fetch(avatar)
      const blob = await res.blob()
      prepared.avatar = await blobToDataUrl(blob)
      return prepared
    }

    const fetchUrl = resolveFetchUrl(avatar, typeof window !== "undefined" ? window.location.origin : undefined)
    if (!fetchUrl) return prepared

    const sameOrigin =
      typeof window !== "undefined" && fetchUrl.startsWith(window.location.origin)
    const requestUrl = sameOrigin
      ? fetchUrl
      : `/api/image-proxy?url=${encodeURIComponent(fetchUrl)}`

    const res = await fetch(requestUrl)
    if (!res.ok) return prepared
    const blob = await res.blob()
    prepared.avatar = await blobToDataUrl(blob)
  } catch {
    /* keep original avatar */
  }

  return prepared
}

export async function waitForResumeImages(page: {
  waitForFunction: (
    fn: () => boolean,
    opts?: { timeout?: number },
  ) => Promise<unknown>
}): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const imgs = Array.from(document.querySelectorAll<HTMLImageElement>(".resume-avatar"))
        if (imgs.length === 0) return true
        return imgs.every((img) => img.complete && img.naturalWidth > 0)
      },
      { timeout: 12_000 },
    )
  } catch {
    await new Promise((r) => setTimeout(r, 400))
  }
}

const LARGE_AVATAR_CHARS = 180_000

export function resumeDataForSessionStorage(data: ResumeData): ResumeData {
  const avatar = data.avatar?.trim()
  if (!avatar || avatar.length <= LARGE_AVATAR_CHARS) return data
  return { ...data, avatar: "about:blank" }
}

export async function ensureResumeAvatarOnPage(
  page: { evaluate: (fn: (src: string) => void, src: string) => Promise<unknown> },
  avatar?: string,
): Promise<void> {
  const src = avatar?.trim()
  if (!src || src === "about:blank") return
  try {
    await page.evaluate((avatarSrc) => {
      document.querySelectorAll<HTMLImageElement>(".resume-avatar").forEach((img) => {
        if (!img.complete || img.naturalWidth === 0 || img.src !== avatarSrc) {
          img.src = avatarSrc
        }
      })
    }, src)
  } catch {
    /* ignore */
  }
}
