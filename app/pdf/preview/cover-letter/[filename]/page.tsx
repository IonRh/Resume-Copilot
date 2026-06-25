"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import PdfLoading from "@/components/pdf-loading"
import type { CoverLetterPrintPayload } from "@/lib/cover-letter-pdf"
import { Button } from "@/components/ui/button"
import { Icon } from "@iconify/react"
import { CoverLetterPDFViewer } from "@/components/cover-letter-pdf-viewer"
import {
  readExportIdFromLocation,
  resolvePdfPreviewPayload,
  startPdfPreviewReadyPing,
  subscribePdfPreviewPayload,
} from "@/lib/pdf-preview-bridge"

function readPrintDataFromClientStorage(): CoverLetterPrintPayload | null {
  const exportId = readExportIdFromLocation(window.location.search)
  const resolved = resolvePdfPreviewPayload<CoverLetterPrintPayload>("coverLetter", exportId)
  if (resolved) return resolved
  try {
    const cached = sessionStorage.getItem("coverLetterPrintData")
    if (cached) return JSON.parse(cached) as CoverLetterPrintPayload
  } catch {
    /* ignore */
  }
  return null
}

function subscribeHydration() {
  return () => {}
}

function CoverLetterPDFPreviewContent() {
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false)
  const [printData, setPrintData] = useState<CoverLetterPrintPayload | null>(null)
  const initialPrintData = useMemo(() => {
    if (!hydrated || typeof window === "undefined") return null
    return readPrintDataFromClientStorage()
  }, [hydrated])
  const [loadError, setLoadError] = useState(false)
  const [fallback, setFallback] = useState(false)
  const hasDataRef = useRef(false)
  const stopReadyPingRef = useRef<(() => void) | null>(null)
  const lastPayloadRef = useRef<string | null>(null)
  const serverFilename =
    hydrated && typeof window !== "undefined"
      ? decodeURIComponent((window.location.pathname || "").split("/").filter(Boolean).pop() || "")
      : undefined

  const effectivePrintData = printData ?? initialPrintData
  const handleModeChange = useCallback((m: "loading" | "server" | "fallback") => {
    setFallback(m === "fallback")
  }, [])

  useEffect(() => {
    if (!hydrated) return
    if (initialPrintData) {
      lastPayloadRef.current = JSON.stringify(initialPrintData)
      hasDataRef.current = true
    }

    const applyData = (data: CoverLetterPrintPayload) => {
      const serialized = JSON.stringify(data)
      if (lastPayloadRef.current === serialized) return
      lastPayloadRef.current = serialized
      hasDataRef.current = true
      setPrintData(data)
      setLoadError(false)
      stopReadyPingRef.current?.()
      stopReadyPingRef.current = null
      try {
        sessionStorage.setItem("coverLetterPrintData", serialized)
      } catch {
        /* ignore */
      }
    }

    const handleMessage = (event: MessageEvent) => {
      const payload = (event as unknown as { data?: { type?: string; data?: CoverLetterPrintPayload } }).data
      if (payload?.type === "coverLetterData" && payload.data) {
        applyData(payload.data)
      }
    }

    window.addEventListener("message", handleMessage)
    const stopBroadcast = subscribePdfPreviewPayload<CoverLetterPrintPayload>("coverLetter", applyData)
    if (!hasDataRef.current) {
      stopReadyPingRef.current = startPdfPreviewReadyPing()
    }
    const errorTimer = window.setTimeout(() => {
      if (!hasDataRef.current) setLoadError(true)
    }, 12_000)

    return () => {
      window.removeEventListener("message", handleMessage)
      stopBroadcast()
      stopReadyPingRef.current?.()
      stopReadyPingRef.current = null
      window.clearTimeout(errorTimer)
    }
  }, [hydrated, initialPrintData])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
        if (fallback) {
          e.preventDefault()
          try {
            const url = new URL("/print/cover-letter", window.location.origin)
            url.searchParams.set("auto", "1")
            window.open(url.toString(), "_blank", "noopener,noreferrer")
          } catch {
            try {
              window.location.href = "/print/cover-letter?auto=1"
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [fallback])

  if (!hydrated) {
    return <PdfLoading fullScreen />
  }

  if (!effectivePrintData) {
    if (loadError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
          <Icon icon="mdi:alert-circle-outline" className="h-10 w-10 text-amber-600" />
          <p className="text-sm text-muted-foreground">未能从父页面接收自荐信数据。请关闭此窗口后重试导出。</p>
          <Button size="sm" variant="outline" onClick={() => window.close()}>
            关闭窗口
          </Button>
        </div>
      )
    }
    return <PdfLoading fullScreen />
  }

  return (
    <div className="pdf-preview-page-root flex h-screen flex-col overflow-hidden print:h-auto print:overflow-visible">
      {fallback && (
        <div className="no-print flex items-center justify-between border-b p-4 print:hidden">
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl font-bold">PDF预览</h1>
            <div className="flex items-baseline gap-1 text-xs text-muted-foreground">
              <Icon icon="mdi:alert-circle" className="h-3.5 w-3.5 text-amber-600" />
              <span>服务器不可用，已切换为浏览器打印。请在打印对话框中关闭“页眉和页脚”，勾选“背景图形”。</span>
              <Button size="sm" className="ml-2 h-6 px-2 py-1 text-xs" onClick={() => window.print()}>
                打印/保存为 PDF
              </Button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden print:h-auto print:overflow-visible">
        <div className="h-full w-full print:h-auto">
          <CoverLetterPDFViewer
            printData={effectivePrintData}
            renderNotice="external"
            serverFilename={serverFilename}
            onModeChange={handleModeChange}
          />
        </div>
      </div>
    </div>
  )
}

export default function CoverLetterPDFPreviewPage() {
  return <CoverLetterPDFPreviewContent />
}
