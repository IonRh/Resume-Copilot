"use client"

import { useCallback, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Icon } from "@iconify/react"
import type { ResumeData } from "@/types/resume"
import { updateEntryData } from "@/lib/storage"
import { saveLocalJsonBackup } from "@/lib/file-backup"
import { AGENT_PROFILES } from "@/lib/agent/prompts"
import { ResumeWorkspaceProvider, useResumeWorkspace } from "@/lib/agent/store"
import { CAREER_BRIEFING_KEY } from "@/components/agent/career-intake-dialog"
import ResumePreview from "@/components/resume-preview"
import ExportButton from "@/components/export-button"
import AgentPanel from "@/components/agent/agent-panel"
import type { WorkspaceSelection } from "@/lib/agent/types"

type CareerMode = "jd" | "interview"

interface CareerWorkspaceProps {
  mode: CareerMode
  entryId: string
  initialData: ResumeData
  onBack?: () => void
}

export default function CareerWorkspace(props: CareerWorkspaceProps) {
  const storageKey = `resume.career.${props.mode}.${props.entryId}`
  return (
    <ResumeWorkspaceProvider initialData={props.initialData} storageKey={storageKey}>
      <CareerInner {...props} />
    </ResumeWorkspaceProvider>
  )
}

function CareerInner({ mode, entryId, onBack }: CareerWorkspaceProps) {
  const ws = useResumeWorkspace()
  const profile = AGENT_PROFILES[mode]
  const briefingReadRef = useRef(false)
  const skipFirstSaveRef = useRef(true)

  const { resumeData } = ws

  // 读取 intake 阶段的简报，设置上下文并自动发起首条指令（仅一次）
  useEffect(() => {
    if (briefingReadRef.current || typeof window === "undefined") return
    briefingReadRef.current = true
    ws.setMode(mode)
    ws.setAgentOpen(true)
    try {
      const raw = window.sessionStorage.getItem(CAREER_BRIEFING_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as { mode?: string; resumeId?: string; briefing?: string }
        if (parsed.mode === mode && parsed.resumeId === entryId) {
          window.sessionStorage.removeItem(CAREER_BRIEFING_KEY)
          if (parsed.briefing) ws.setJd(parsed.briefing)
        }
      }
    } catch {
      /* ignore */
    }
    ws.setKickoff(profile.intake?.initialPrompt ?? "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 接受 AI 优化后自动回写到该简历，避免丢失（跳过首挂载的空写）
  useEffect(() => {
    if (!entryId) return
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      try {
        const updated = updateEntryData(entryId, resumeData)
        void saveLocalJsonBackup(entryId, updated.resumeData).catch(() => false)
      } catch {
        /* 持久化失败不阻塞使用 */
      }
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [entryId, resumeData])

  const onRequestAI = useCallback(
    (selection: WorkspaceSelection) => ws.setSelection(selection),
    [ws],
  )

  return (
    <div className="rw-shell">
      <div className="rw-toolbar">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="brand-gradient-bg grid h-7 w-7 place-items-center rounded-lg">
              <Icon icon={profile.icon} className="h-4 w-4" />
            </span>
            <h1 className="hidden text-base font-semibold sm:block">{profile.name}</h1>
          </div>
          <Badge variant="secondary" className="max-w-[180px] truncate text-xs">
            {resumeData.title || "未命名"}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {onBack ? (
            <Button variant="outline" size="sm" onClick={() => onBack?.()} className="gap-2 bg-transparent">
              <Icon icon="mdi:arrow-left" className="h-4 w-4" />
              <span className="hidden sm:inline">返回</span>
            </Button>
          ) : null}
          <div className="hidden items-center sm:flex">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={!ws.canUndo} onClick={ws.undo} title="撤销">
              <Icon icon="mdi:undo" className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={!ws.canRedo} onClick={ws.redo} title="重做">
              <Icon icon="mdi:redo" className="h-4 w-4" />
            </Button>
          </div>
          <Separator orientation="vertical" className="hidden h-6 sm:block" />
          <ExportButton resumeData={resumeData} size="sm" />
        </div>
      </div>

      <div className="career-body">
        <div className="rw-preview">
          <div className="p-4">
            <ResumePreview
              resumeData={resumeData}
              interactive
              selectedId={ws.selection?.id ?? null}
              highlightedIds={ws.highlightedIds}
              onSelect={ws.setSelection}
              onRequestAI={onRequestAI}
            />
          </div>
        </div>
        <AgentPanel lockedMode={mode} />
      </div>
    </div>
  )
}
