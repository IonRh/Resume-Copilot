"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import type { CoverLetterPrintPayload } from "@/lib/cover-letter-pdf"
import { generateCoverLetterPdfFilename } from "@/lib/cover-letter-pdf"
import CoverLetterPrintContent from "@/components/cover-letter-print-content"
import PdfLoading from "@/components/pdf-loading"

const FORCE_PRINT = process.env.NEXT_PUBLIC_FORCE_PRINT === "true"
const FORCE_SERVER = process.env.NEXT_PUBLIC_FORCE_SERVER_PDF === "true"
const SERVER_PDF_TIMEOUT_MS = 45000

async function fetchWithTimeout(input: RequestInfo, init?: RequestInit & { timeout?: number }) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), init?.timeout ?? 3000)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(t)
  }
}

async function checkServerPdfAvailable(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout("/api/pdf/health", { method: "GET", timeout: 3000, cache: "no-store" })
    if (!res.ok) return false
    const data = await res.json().catch(() => ({}))
    return !!data.ok
  } catch {
    return false
  }
}

export type Mode = "loading" | "server" | "fallback"

export function CoverLetterPDFViewer({
  printData,
  onModeChange,
  renderNotice = "internal",
  serverFilename,
}: {
  printData: CoverLetterPrintPayload
  onModeChange?: (mode: Mode) => void
  renderNotice?: "internal" | "external"
  serverFilename?: string
}) {
  const [mode, setMode] = useState<Mode>("loading")
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hasServerPdfRef = useRef(false)
  const printKey = useMemo(() => JSON.stringify(printData), [printData])
  const genIdRef = useRef(0)

  useEffect(() => {
    let mounted = true
    let urlToRevoke: string | null = null
    const currentId = ++genIdRef.current

    const run = async () => {
      if (FORCE_PRINT) {
        if (mounted) setMode("fallback")
        onModeChange?.("fallback")
        return
      }

      let available = FORCE_SERVER
      if (!available) {
        try {
          const KEY = "serverPdfAvailable:v1"
          const raw = sessionStorage.getItem(KEY)
          const now = Date.now()
          const ttlMs = 30 * 1000
          let cachedOk: boolean | null = null
          if (raw) {
            try {
              const rec = JSON.parse(raw) as { value: boolean; expires: number }
              if (rec && typeof rec.expires === "number" && rec.expires > now) {
                cachedOk = !!rec.value
              } else {
                sessionStorage.removeItem(KEY)
              }
            } catch {
              sessionStorage.removeItem(KEY)
            }
          }
          if (cachedOk === null) {
            const ok = await checkServerPdfAvailable()
            sessionStorage.setItem(KEY, JSON.stringify({ value: ok, expires: now + ttlMs }))
            available = ok
          } else {
            available = cachedOk
          }
        } catch {
          available = await checkServerPdfAvailable()
        }
      }

      if (!available) {
        if (mounted) setMode("fallback")
        onModeChange?.("fallback")
        return
      }

      if (renderNotice === "external") {
        if (!mounted) return
        setMode("server")
        onModeChange?.("server")
        await new Promise((r) => setTimeout(r, 0))
        try {
          const parsed: CoverLetterPrintPayload = JSON.parse(printKey)
          const targetName = serverFilename || generateCoverLetterPdfFilename(parsed.title || "")
          const res = await fetchWithTimeout(`/api/pdf/cover-letter/${targetName}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ coverLetterData: parsed }),
            timeout: SERVER_PDF_TIMEOUT_MS,
          })
          if (!res.ok) {
            const ct = res.headers.get("content-type") || ""
            let detail = ""
            try {
              if (ct.includes("application/json")) {
                const j = await res.json()
                detail = j?.error ? String(j.error) : JSON.stringify(j)
              } else {
                detail = await res.text()
              }
            } catch {
              /* ignore */
            }
            throw new Error(`Failed to generate PDF (${res.status}). ${detail}`)
          }
          if (!mounted || genIdRef.current !== currentId) return
          window.location.assign(res.url || `/api/pdf/cover-letter/${targetName}`)
        } catch (e) {
          console.error(e)
          if (!mounted || genIdRef.current !== currentId) return
          setError(e instanceof Error ? e.message : String(e))
          setMode("fallback")
          onModeChange?.("fallback")
        }
        return
      }

      try {
        const parsed: CoverLetterPrintPayload = JSON.parse(printKey)
        const filename = serverFilename || generateCoverLetterPdfFilename(parsed.title || "")
        const res = await fetch(`/api/pdf/cover-letter/${filename}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ coverLetterData: parsed }),
        })
        if (!res.ok) {
          const ct = res.headers.get("content-type") || ""
          let detail = ""
          try {
            if (ct.includes("application/json")) {
              const j = await res.json()
              detail = j?.error ? String(j.error) : JSON.stringify(j)
            } else {
              detail = await res.text()
            }
          } catch {
            /* ignore */
          }
          throw new Error(`Failed to generate PDF (${res.status}). ${detail}`)
        }
        const blob = await res.blob()
        if (!mounted || genIdRef.current !== currentId) return
        const url = URL.createObjectURL(blob)
        urlToRevoke = url
        setPdfUrl(url)
        setMode("server")
        onModeChange?.("server")
        hasServerPdfRef.current = true
      } catch (e) {
        console.error(e)
        if (!mounted || genIdRef.current !== currentId) return
        setError(e instanceof Error ? e.message : String(e))
        if (!hasServerPdfRef.current) {
          setMode("fallback")
          onModeChange?.("fallback")
        }
      }
    }

    const t = setTimeout(run, 250)
    return () => {
      mounted = false
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke)
      clearTimeout(t)
    }
  }, [printKey, onModeChange, renderNotice, serverFilename])

  if (mode === "server") {
    if (renderNotice === "external") {
      return <PdfLoading message="正在打开浏览器 PDF 查看器..." />
    }
    return (
      <object data={pdfUrl || undefined} type="application/pdf" width="100%" height="100%" style={{ border: "none" }}>
        <div className="p-6 text-center text-muted-foreground">无法嵌入预览，请下载后查看。</div>
      </object>
    )
  }

  if (mode === "loading") {
    return <PdfLoading />
  }

  return (
    <div className="h-full w-full pdf-fallback-container">
      {renderNotice === "internal" && (
        <div className="no-print border-b bg-white p-3">
          <div className="text-sm text-muted-foreground">
            {error ? (
              <span>服务器生成失败，已切换为浏览器打印。{error}</span>
            ) : (
              <span>服务器不可用，已切换为浏览器打印。</span>
            )}
            <span className="ml-2 text-foreground">请在打印对话框中：关闭“页眉和页脚”，勾选“背景图形”。</span>
            <button
              onClick={() => {
                try {
                  sessionStorage.setItem("coverLetterPrintData", printKey)
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
              }}
              className="ml-3 inline-flex items-center rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            >
              打开纯净打印页
            </button>
          </div>
        </div>
      )}
      <CoverLetterPrintContent initialData={printData} />
    </div>
  )
}

export default CoverLetterPDFViewer
