const STORAGE_PREFIX = "pdfPreview:v1:"
const BROADCAST_CHANNEL = "pdfPreview:v1"
const TTL_MS = 5 * 60 * 1000
const HANDSHAKE_MS = 60_000
const READY_INTERVAL_MS = 400

export type PdfPreviewKind = "resume" | "coverLetter"

type Stashed<T> = { data: T; expires: number; kind: PdfPreviewKind }

function stashKey(exportId: string) {
  return `${STORAGE_PREFIX}${exportId}`
}

function latestKey(kind: PdfPreviewKind) {
  return `${STORAGE_PREFIX}latest:${kind}`
}

export function createExportId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function writeStash<T>(key: string, record: Stashed<T>): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(record))
    return true
  } catch {
    return false
  }
}

export function stashPdfPreviewPayload<T>(exportId: string, kind: PdfPreviewKind, data: T): boolean {
  const record: Stashed<T> = { data, expires: Date.now() + TTL_MS, kind }
  const okId = writeStash(stashKey(exportId), record)
  writeStash(latestKey(kind), record)
  return okId
}

function readStashRecord<T>(key: string): Stashed<T> | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const record = JSON.parse(raw) as Stashed<T>
    if (!record?.data || typeof record.expires !== "number" || record.expires <= Date.now()) {
      localStorage.removeItem(key)
      return null
    }
    return record
  } catch {
    return null
  }
}

export function readStashedPdfPreviewPayload<T>(exportId: string): T | null {
  const record = readStashRecord<T>(stashKey(exportId))
  return record?.data ?? null
}

export function readLatestPdfPreviewPayload<T>(kind: PdfPreviewKind): T | null {
  const record = readStashRecord<T>(latestKey(kind))
  if (!record || record.kind !== kind) return null
  return record.data
}

export function clearStashedPdfPreviewPayload(exportId: string): void {
  try {
    localStorage.removeItem(stashKey(exportId))
  } catch {
    /* ignore */
  }
}

export function resolvePdfPreviewPayload<T>(kind: PdfPreviewKind, exportId?: string | null): T | null {
  if (exportId) {
    const byId = readStashedPdfPreviewPayload<T>(exportId)
    if (byId) {
      clearStashedPdfPreviewPayload(exportId)
      return byId
    }
  }
  return readLatestPdfPreviewPayload<T>(kind)
}

export function readExportIdFromLocation(search = ""): string | null {
  try {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
    const id = params.get("export")?.trim()
    return id || null
  } catch {
    return null
  }
}

export function broadcastPdfPreviewPayload(kind: PdfPreviewKind, exportId: string, data: unknown): void {
  try {
    const channel = new BroadcastChannel(BROADCAST_CHANNEL)
    channel.postMessage({ kind, exportId, data })
    channel.close()
  } catch {
    /* BroadcastChannel unavailable */
  }
}

export function subscribePdfPreviewPayload<T>(
  kind: PdfPreviewKind,
  onData: (data: T) => void,
): () => void {
  try {
    const channel = new BroadcastChannel(BROADCAST_CHANNEL)
    channel.onmessage = (event: MessageEvent) => {
      const payload = event.data as { kind?: PdfPreviewKind; data?: T } | null
      if (payload?.kind === kind && payload.data) {
        onData(payload.data)
      }
    }
    return () => channel.close()
  } catch {
    return () => {}
  }
}

/** Parent: open preview window and respond to child `ready` for up to HANDSHAKE_MS. */
export function openPdfPreviewWithHandshake(
  path: string,
  sendToChild: (child: Window) => void,
): Window | null {
  const child = window.open(path, "_blank")
  if (!child) return null

  let delivered = false
  let cleanupTimer = 0

  const cleanup = () => {
    window.removeEventListener("message", onMessage)
    if (cleanupTimer) {
      window.clearTimeout(cleanupTimer)
      cleanupTimer = 0
    }
  }

  const deliver = () => {
    if (delivered || child.closed) return
    try {
      sendToChild(child)
      delivered = true
      cleanup()
    } catch {
      /* ignore cross-origin / detached window */
    }
  }

  const onMessage = (event: MessageEvent) => {
    if (event.source !== child) return
    const payload = event.data as { type?: string } | null
    if (payload?.type === "ready") deliver()
  }

  window.addEventListener("message", onMessage)
  cleanupTimer = window.setTimeout(cleanup, HANDSHAKE_MS)
  deliver()
  return child
}

/** Child: poll opener with `ready`, retry until unmounted or timeout. */
export function startPdfPreviewReadyPing(): () => void {
  if (!window.opener) return () => {}

  const ping = () => {
    try {
      window.opener?.postMessage({ type: "ready" }, "*")
    } catch {
      /* ignore */
    }
  }

  ping()
  const timer = window.setInterval(ping, READY_INTERVAL_MS)
  const stopTimer = window.setTimeout(() => window.clearInterval(timer), HANDSHAKE_MS)

  return () => {
    window.clearInterval(timer)
    window.clearTimeout(stopTimer)
  }
}
