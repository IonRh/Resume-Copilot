"use client"

import { useState } from "react"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { CoverLetterDraft } from "@/lib/agent/types"
import {
  exportCoverLetterAsMarkdown,
  exportCoverLetterAsPdf,
  exportCoverLetterAsTxt,
} from "@/lib/cover-letter-export"
import { coverLetterDisplayTitle } from "@/types/cover-letter"
import { useToast } from "@/hooks/use-toast"

interface CoverLetterExportButtonProps {
  title: string
  draft: CoverLetterDraft
  resumeTitle?: string
  disabled?: boolean
  size?: "default" | "sm" | "lg" | "icon"
  variant?: "default" | "outline" | "ghost" | "secondary"
  className?: string
}

export default function CoverLetterExportButton({
  title,
  draft,
  resumeTitle,
  disabled,
  size = "sm",
  variant = "outline",
  className,
}: CoverLetterExportButtonProps) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const displayTitle = coverLetterDisplayTitle({ title, draft, resumeTitle: resumeTitle || "" })

  const runExport = async (kind: "txt" | "md" | "pdf") => {
    setBusy(true)
    try {
      if (kind === "txt") exportCoverLetterAsTxt(displayTitle, draft)
      if (kind === "md") exportCoverLetterAsMarkdown(displayTitle, draft)
      if (kind === "pdf") exportCoverLetterAsPdf(displayTitle, draft)
      toast({
        title: kind === "pdf" ? "正在生成 PDF" : "导出成功",
        description: kind === "pdf" ? "请在新窗口中等待 PDF 生成完成。" : "文件已开始下载。",
      })
    } catch (error) {
      toast({
        title: "导出失败",
        description: error instanceof Error ? error.message : "未知错误",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={size} variant={variant} className={`gap-2 ${className || ""}`} disabled={disabled || busy}>
          <Icon icon={busy ? "mdi:loading" : "mdi:download-outline"} className={`h-4 w-4 ${busy ? "agent-spin" : ""}`} />
          <span className="hidden sm:inline">导出</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void runExport("txt")}>
          <Icon icon="mdi:file-document-outline" className="mr-2 h-4 w-4" /> 导出 TXT
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void runExport("md")}>
          <Icon icon="mdi:language-markdown" className="mr-2 h-4 w-4" /> 导出 Markdown
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void runExport("pdf")}>
          <Icon icon="mdi:file-pdf-box" className="mr-2 h-4 w-4" /> 导出 PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
