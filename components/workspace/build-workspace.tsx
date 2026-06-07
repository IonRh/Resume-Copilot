"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import type { ResumeData } from "@/types/resume"
import { updateEntryData } from "@/lib/storage"
import { useToast } from "@/hooks/use-toast"
import { AGENT_PROFILES } from "@/lib/agent/prompts"
import { ResumeWorkspaceProvider, useResumeWorkspace } from "@/lib/agent/store"
import { genId } from "@/lib/agent/changeset"
import ResumePreview from "@/components/resume-preview"
import ExportButton from "@/components/export-button"
import AgentPanel from "@/components/agent/agent-panel"
import type { WorkspaceSelection } from "@/lib/agent/types"

interface BuildWorkspaceProps {
  entryId: string
  initialData: ResumeData
  onBack?: () => void
}

const GREETING = [
  "你好！我是你的**创建助手** 👋 接下来我会像聊天一样，一步步陪你把这份简历从零搭好。",
  "",
  "我们先从最基础的开始吧：",
  "",
  "1. 你的**姓名**是？",
  "2. 想投递的**目标岗位/方向**是什么？（例如：前端开发、产品经理、应届生求职…）",
  "",
  "随便先说一个就行，不用一次说全，我会帮你逐项整理到左侧简历里。",
].join("\n")

export default function BuildWorkspace(props: BuildWorkspaceProps) {
  // 每份「和 AI 聊聊」的简历绑定唯一会话：用 entryId 作为持久化 key，再次进入可继续上次对话
  const storageKey = `resume.build.${props.entryId}`
  return (
    <ResumeWorkspaceProvider initialData={props.initialData} storageKey={storageKey}>
      <BuildInner {...props} />
    </ResumeWorkspaceProvider>
  )
}

function BuildInner({ entryId, onBack }: BuildWorkspaceProps) {
  const ws = useResumeWorkspace()
  const router = useRouter()
  const { toast } = useToast()
  const profile = AGENT_PROFILES.build
  const { resumeData } = ws
  const [finishing, setFinishing] = useState(false)
  const greetedRef = useRef(false)
  const skipFirstSaveRef = useRef(true)

  // 进入创建页：锁定 build 模式、打开 Agent 面板、清空选中
  useEffect(() => {
    ws.setMode("build")
    ws.setAgentOpen(true)
    ws.clearSelection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 水合完成后，若为全新会话则注入引导式开场白（仅一次，不发起 API 调用）
  useEffect(() => {
    if (greetedRef.current || !ws.hydrated) return
    if (ws.turns.length > 0) {
      greetedRef.current = true
      return
    }
    greetedRef.current = true
    ws.addTurn({ id: genId("turn"), role: "assistant", content: GREETING })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.hydrated])

  // 每次 Agent 编辑（接受变更）后自动保存到后台，跳过首挂载的空写
  useEffect(() => {
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      void updateEntryData(entryId, resumeData).catch(() => {
        /* 持久化失败不阻塞使用 */
      })
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [entryId, resumeData])

  const onRequestAI = useCallback(
    (selection: WorkspaceSelection) => ws.setSelection(selection),
    [ws],
  )

  // 「好了，我来动手」：结束对话创建阶段，转为可手动编辑的普通简历，进入编辑器
  const handleFinish = useCallback(async () => {
    setFinishing(true)
    try {
      const next: ResumeData = { ...resumeData, buildMode: false }
      await updateEntryData(entryId, next)
      router.push(`/edit/${entryId}`)
    } catch (e) {
      toast({
        title: "保存失败",
        description: e instanceof Error ? e.message : "未知错误",
        variant: "destructive",
      })
      setFinishing(false)
    }
  }, [entryId, resumeData, router, toast])

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
          <Button
            size="sm"
            onClick={() => void handleFinish()}
            disabled={finishing}
            className="brand-gradient-bg gap-2 border-0"
            title="结束 AI 引导，进入编辑器自己动手"
          >
            {finishing ? (
              <>
                <Icon icon="mdi:loading" className="agent-spin h-4 w-4" /> 处理中
              </>
            ) : (
              <>
                <Icon icon="mdi:check" className="h-4 w-4" /> 好了，我来动手
              </>
            )}
          </Button>
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
        <AgentPanel lockedMode="build" hideSessionControls />
      </div>
    </div>
  )
}
