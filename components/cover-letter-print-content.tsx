"use client"

import React, { useState } from "react"
import RichTextRenderer from "@/components/rich-text-renderer"
import { emptyCoverLetterDoc, normalizeCoverLetterBody } from "@/lib/cover-letter-document"
import type { CoverLetterPrintPayload } from "@/lib/cover-letter-pdf"

export default function CoverLetterPrintContent({
  initialData,
  autoPrint = false,
}: {
  initialData?: CoverLetterPrintPayload | null
  autoPrint?: boolean
}) {
  const [payload] = useState<CoverLetterPrintPayload | null>(() => {
    if (initialData) {
      const normalized = normalizeCoverLetterBody(initialData.draft)
      return {
        title: initialData.title,
        draft: { ...initialData.draft, ...normalized },
      }
    }
    if (typeof window !== "undefined") {
      try {
        const raw = sessionStorage.getItem("coverLetterPrintData")
        if (raw) {
          const parsed = JSON.parse(raw) as CoverLetterPrintPayload
          const normalized = normalizeCoverLetterBody(parsed.draft)
          return { title: parsed.title, draft: { ...parsed.draft, ...normalized } }
        }
      } catch {
        /* ignore */
      }
    }
    return null
  })

  React.useEffect(() => {
    let done = false
    const run = async () => {
      if (!autoPrint || !payload || done) return
      done = true
      try {
        const anyDoc = document as unknown as { fonts?: { ready?: Promise<unknown> } }
        if (anyDoc.fonts?.ready) await anyDoc.fonts.ready
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          window.print()
        } catch {
          /* ignore */
        }
      }, 30)
    }
    void run()
    return () => {
      done = true
    }
  }, [autoPrint, payload])

  const bodyContent = payload?.draft.bodyContent || emptyCoverLetterDoc()

  return (
    <div className="pdf-preview-mode cover-letter-print-content">
      {payload ? (
        <div className="cover-letter-print-paper">
          {payload.title?.trim() ? <h1 className="cover-letter-print-title">{payload.title.trim()}</h1> : null}
          <div className="cover-letter-print-body">
            <RichTextRenderer content={bodyContent} />
          </div>
        </div>
      ) : (
        <div className="p-8">
          <h1 className="mb-4 text-xl font-bold">无法加载自荐信数据</h1>
          <p className="text-muted-foreground">请通过导出功能或后端生成接口访问本页面。</p>
        </div>
      )}
    </div>
  )
}
