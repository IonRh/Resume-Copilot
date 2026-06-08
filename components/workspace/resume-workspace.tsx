"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Icon } from "@iconify/react"
import type { ResumeData } from "@/types/resume"
import { createDefaultResumeData } from "@/lib/resume-core"
import { loadDefaultTemplate, loadExampleTemplate } from "@/lib/storage"
import { useIsMobile } from "@/hooks/use-mobile"
import { ResumeWorkspaceProvider, useResumeWorkspace } from "@/lib/agent/store"
import ResumePreview from "@/components/resume-preview"
import ExportButton from "@/components/export-button"
import EditorPanel from "./editor-panel"
import CheckupAssistant from "./checkup-assistant"
import AgentPanel from "@/components/agent/agent-panel"
import type { WorkspaceSelection } from "@/lib/agent/types"

type ViewMode = "both" | "edit-only" | "preview-only"

interface ResumeWorkspaceProps {
  initialData?: ResumeData
  template?: "default" | "example"
  entryId?: string
  onChange?: (data: ResumeData) => void
  onSave?: (data: ResumeData) => void
  onBack?: () => void
}

const ViewModeSelector = memo(
  ({ viewMode, onViewModeChange }: { viewMode: ViewMode; onViewModeChange: (mode: ViewMode) => void }) => {
    const modes = [
      { key: "both" as ViewMode, label: "编辑+预览", icon: "mdi:view-split-vertical" },
      { key: "edit-only" as ViewMode, label: "仅编辑", icon: "mdi:pencil" },
      { key: "preview-only" as ViewMode, label: "仅预览", icon: "mdi:eye" },
    ]
    return (
      <div className="relative inline-flex bg-muted rounded-lg p-1">
        {modes.map((mode) => (
          <button
            key={mode.key}
            onClick={() => onViewModeChange(mode.key)}
            className={`relative px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 flex items-center gap-2 justify-center ${
              viewMode === mode.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon icon={mode.icon} className="w-4 h-4" />
            <span className="hidden lg:inline">{mode.label}</span>
          </button>
        ))}
      </div>
    )
  },
)
ViewModeSelector.displayName = "ViewModeSelector"

export default function ResumeWorkspace(props: ResumeWorkspaceProps) {
  const initial = props.initialData ?? createDefaultResumeData()
  const storageKey = `resume.agent.${props.entryId ?? "new"}`
  return (
    <ResumeWorkspaceProvider initialData={initial} storageKey={storageKey}>
      <WorkspaceInner {...props} />
    </ResumeWorkspaceProvider>
  )
}

function WorkspaceInner({
  initialData,
  template = "default",
  onChange,
  onSave,
  onBack,
}: ResumeWorkspaceProps) {
  const ws = useResumeWorkspace()
  const isMobile = useIsMobile()
  const [viewMode, setViewMode] = useState<ViewMode>("both")
  const [editorCollapsed, setEditorCollapsed] = useState(false)
  const kickoffReadRef = useRef(false)

  const { resumeData, setInitial } = ws

  // 主页「求职工具」入口会写入 sessionStorage，进入工作区后自动呼出 AI 并发起对应任务。
  useEffect(() => {
    if (kickoffReadRef.current || typeof window === "undefined") return
    kickoffReadRef.current = true
    try {
      const raw = window.sessionStorage.getItem("agent-kickoff")
      if (!raw) return
      window.sessionStorage.removeItem("agent-kickoff")
      const parsed = JSON.parse(raw) as { prompt?: string }
      if (parsed.prompt) {
        ws.setAgentOpen(true)
        ws.setKickoff(parsed.prompt)
      }
    } catch {
      /* ignore malformed kickoff payload */
    }
  }, [ws])

  // 模板加载（仅在未提供 initialData 时）
  useEffect(() => {
    if (initialData) return
    let cancelled = false
    const run = async () => {
      const tpl = template === "example" ? await loadExampleTemplate() : await loadDefaultTemplate()
      if (!tpl || cancelled) return
      setInitial(tpl)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [initialData, template, setInitial])

  // 变更上报父组件
  useEffect(() => {
    onChange?.(resumeData)
  }, [resumeData, onChange])

  const agentOpen = ws.agentOpen
  const mobileOverlay = isMobile && agentOpen
  const showEditor = mobileOverlay ? false : agentOpen ? !editorCollapsed : viewMode !== "preview-only"
  const showPreview = mobileOverlay ? true : agentOpen ? true : viewMode !== "edit-only"

  const onRequestAI = useCallback(
    (selection: WorkspaceSelection) => {
      ws.setSelection(selection)
      ws.setAgentOpen(true)
    },
    [ws],
  )

  return (
    <div className="rw-shell">
      {/* 工具栏 */}
      <div className="rw-toolbar">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="brand-gradient-bg grid h-7 w-7 place-items-center rounded-lg">
              <Icon icon="mdi:file-account-outline" className="h-4 w-4" />
            </span>
            <h1 className="hidden text-base font-semibold sm:block">
              <span className="brand-gradient-text">AI</span> 简历工作区
            </h1>
          </div>
          <Badge variant="secondary" className="max-w-[160px] truncate text-xs">
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

          {/* 撤销 / 重做 */}
          <div className="hidden items-center sm:flex">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={!ws.canUndo}
              onClick={ws.undo}
              title="撤销"
            >
              <Icon icon="mdi:undo" className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={!ws.canRedo}
              onClick={ws.redo}
              title="重做"
            >
              <Icon icon="mdi:redo" className="h-4 w-4" />
            </Button>
          </div>

          <Separator orientation="vertical" className="hidden h-6 sm:block" />

          {!agentOpen ? <ViewModeSelector viewMode={viewMode} onViewModeChange={setViewMode} /> : null}

          {agentOpen && !isMobile ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2"
              onClick={() => setEditorCollapsed((v) => !v)}
              title={editorCollapsed ? "显示编辑区" : "隐藏编辑区"}
            >
              <Icon icon={editorCollapsed ? "mdi:dock-left" : "mdi:dock-window"} className="h-4 w-4" />
            </Button>
          ) : null}

          <CheckupAssistant />

          {onSave ? (
            <Button
              size="sm"
              onClick={() => onSave?.(resumeData)}
              className="gap-2 bg-green-600 text-white hover:bg-green-700"
            >
              <Icon icon="mdi:content-save" className="h-4 w-4" />
              <span className="hidden sm:inline">保存</span>
            </Button>
          ) : null}

          <ExportButton resumeData={resumeData} size="sm" />

          {/* 呼出 Agent */}
          <Button
            size="sm"
            onClick={() => ws.toggleAgent()}
            className={`gap-2 border-0 ${agentOpen ? "bg-muted text-foreground hover:bg-muted/80" : "brand-gradient-bg"}`}
          >
            <Icon icon={agentOpen ? "mdi:robot-happy" : "mdi:robot-happy-outline"} className="h-4 w-4" />
            <span className="hidden sm:inline">{agentOpen ? "AI 已开启" : "AI 助手"}</span>
            {ws.pendingCount > 0 ? (
              <span className="ml-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-white/90 px-1 text-[10px] font-bold text-primary">
                {ws.pendingCount}
              </span>
            ) : null}
          </Button>
        </div>
      </div>

      {/* 主体三分屏 */}
      <div className="rw-body">
        {showEditor ? (
          <div
            className="rw-edit"
            style={agentOpen ? { flex: "0 0 clamp(380px, 30vw, 480px)", minWidth: 380 } : { flex: 1 }}
          >
            <EditorPanel dense={agentOpen} />
          </div>
        ) : null}

        {showPreview ? (
          <div className="rw-preview" style={{ flex: 1 }}>
            <div className={agentOpen ? "p-4" : ""}>
              <ResumePreview
                resumeData={resumeData}
                interactive={agentOpen}
                selectedId={ws.selection?.id ?? null}
                highlightedIds={ws.highlightedIds}
                onSelect={ws.setSelection}
                onRequestAI={onRequestAI}
              />
            </div>
          </div>
        ) : null}

        {agentOpen ? <AgentPanel asOverlay={mobileOverlay} /> : null}
      </div>
    </div>
  )
}
