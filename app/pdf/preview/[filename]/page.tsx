"use client"
// Copyright (c) 2025 wzdnzd
// SPDX-License-Identifier: MIT

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import PdfLoading from "@/components/pdf-loading"
import type { ResumeData } from "@/types/resume"
import { Button } from "@/components/ui/button"
import { Icon } from "@iconify/react"
import { PDFViewer } from "@/components/pdf-viewer"
import {
  readExportIdFromLocation,
  resolvePdfPreviewPayload,
  startPdfPreviewReadyPing,
  subscribePdfPreviewPayload,
} from "@/lib/pdf-preview-bridge"

function readResumeDataFromClientStorage(): ResumeData | null {
  const exportId = readExportIdFromLocation(window.location.search)
  const resolved = resolvePdfPreviewPayload<ResumeData>("resume", exportId)
  if (resolved) return resolved
  try {
    const cached = sessionStorage.getItem("resumeData")
    if (cached) return JSON.parse(cached) as ResumeData
  } catch {
    /* ignore */
  }
  return null
}

function PDFPreviewContent() {
  const [resumeData, setResumeData] = useState<ResumeData | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [fallback, setFallback] = useState(false)
  const hasDataRef = useRef(false)
  const serverFilename =
    typeof window !== "undefined"
      ? decodeURIComponent((window.location.pathname || "").split("/").filter(Boolean).pop() || "")
      : undefined

  useLayoutEffect(() => {
    const initial = readResumeDataFromClientStorage()
    if (initial) {
      hasDataRef.current = true
      setResumeData(initial)
    }
  }, [])

  useEffect(() => {
    const applyData = (data: ResumeData) => {
      hasDataRef.current = true
      setResumeData(data)
      setLoadError(false)
      try {
        sessionStorage.setItem("resumeData", JSON.stringify(data))
      } catch {
        /* ignore */
      }
    }

    const handleMessage = (event: MessageEvent) => {
      const payload = (event as unknown as { data?: { type?: string; data?: ResumeData } }).data
      if (payload?.type === "resumeData" && payload.data) {
        applyData(payload.data)
      }
    }

    window.addEventListener("message", handleMessage)
    const stopBroadcast = subscribePdfPreviewPayload<ResumeData>("resume", applyData)
    const stopReadyPing = startPdfPreviewReadyPing()
    const errorTimer = window.setTimeout(() => {
      if (!hasDataRef.current) setLoadError(true)
    }, 12_000)

    return () => {
      window.removeEventListener("message", handleMessage)
      stopBroadcast()
      stopReadyPing()
      window.clearTimeout(errorTimer)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
        if (fallback) {
          e.preventDefault()
          try {
            const url = new URL("/print", window.location.origin)
            url.searchParams.set("auto", "1")
            window.open(url.toString(), "_blank", "noopener,noreferrer")
          } catch {
            try {
              window.location.href = "/print?auto=1"
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

  if (!resumeData) {
    if (loadError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
          <Icon icon="mdi:alert-circle-outline" className="h-10 w-10 text-amber-600" />
          <p className="text-sm text-muted-foreground">未能从父页面接收简历数据。请关闭此窗口后重试导出。</p>
          <Button size="sm" variant="outline" onClick={() => window.close()}>
            关闭窗口
          </Button>
        </div>
      )
    }
    return <PdfLoading fullScreen />
  }

  return (
    <div className="pdf-preview-page-root flex flex-col h-screen overflow-hidden print:h-auto print:overflow-visible">
      {fallback && (
        <div className="flex items-center justify-between p-4 border-b no-print print:hidden">
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl font-bold">PDF预览</h1>
            <div className="flex items-baseline gap-1 text-xs text-muted-foreground">
              <Icon icon="mdi:alert-circle" className="w-3.5 h-3.5 text-amber-600" />
              <span>服务器不可用，已切换为浏览器打印。请在打印对话框中关闭“页眉和页脚”，勾选“背景图形”。</span>
              <Button size="sm" className="ml-2 h-6 px-2 py-1 text-xs" onClick={() => window.print()}>
                打印/保存为 PDF
              </Button>
            </div>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-hidden flex print:overflow-visible print:h-auto">
        <div className="w-full h-full print:h-auto">
          <PDFViewer
            resumeData={resumeData}
            renderNotice="external"
            serverFilename={serverFilename}
            onModeChange={(m) => setFallback(m === "fallback")}
          />
        </div>
      </div>
    </div>
  )
}

export default function PDFPreviewPage() {
  return <PDFPreviewContent />
}
