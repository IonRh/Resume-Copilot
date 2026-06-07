"use client"

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Icon } from "@iconify/react"
import type { ResumeData } from "@/types/resume"
import { createEntryFromData, stashResumeForEdit, updateEntryData } from "@/lib/storage"
import { buildJdVariantTitle, createJdVariantResumeData } from "@/lib/resume-relations"
import { useToast } from "@/hooks/use-toast"
import { useRouter } from "next/navigation"
import { AGENT_PROFILES } from "@/lib/agent/prompts"
import { ResumeWorkspaceProvider, useResumeWorkspace } from "@/lib/agent/store"
import { CAREER_BRIEFING_KEY } from "@/components/agent/career-intake-dialog"
import ResumePreview from "@/components/resume-preview"
import ExportButton from "@/components/export-button"
import AgentPanel, { type AgentPanelHandle } from "@/components/agent/agent-panel"
import type { AgentCard, WorkspaceSelection } from "@/lib/agent/types"

type CareerMode = "jd" | "interview" | "discover"

interface CareerWorkspaceProps {
  mode: CareerMode
  entryId: string
  initialData: ResumeData
  sessionId?: string
  onBack?: () => void
}

export default function CareerWorkspace(props: CareerWorkspaceProps) {
  const storageKey = `resume.career.${props.mode}.${props.entryId}`
  if (props.mode === "interview") {
    return <InterviewWorkspace {...props} />
  }
  return (
    <ResumeWorkspaceProvider initialData={props.initialData} storageKey={storageKey}>
      <CareerInner {...props} />
    </ResumeWorkspaceProvider>
  )
}

function InterviewWorkspace(props: CareerWorkspaceProps) {
  const initialBriefing = useRef<{ briefing: string; sessionId: string } | null>(null)
  if (initialBriefing.current === null && typeof window !== "undefined") {
    let next = { briefing: "", sessionId: "" }
    try {
      const raw = window.sessionStorage.getItem(CAREER_BRIEFING_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as { mode?: string; resumeId?: string; briefing?: string; sessionId?: string }
        if (parsed.mode === props.mode && parsed.resumeId === props.entryId) {
          window.sessionStorage.removeItem(CAREER_BRIEFING_KEY)
          next = {
            briefing: parsed.briefing || "",
            sessionId: parsed.sessionId || "",
          }
        }
      }
    } catch {
      /* ignore */
    }
    initialBriefing.current = next
  }
  const [briefing] = useState<string>(() => initialBriefing.current?.briefing || "")
  const [sessionId] = useState<string>(() => props.sessionId || initialBriefing.current?.sessionId || `page-${Date.now()}`)
  const storageScope = `${props.entryId}.${sessionId}`
  const analysisStorageKey = `resume.career.${props.mode}.${storageScope}.analysis`
  const interviewerStorageKey = `resume.career.${props.mode}.${storageScope}.interviewer`

  return (
    <ResumeWorkspaceProvider initialData={props.initialData} storageKey={interviewerStorageKey}>
      <CareerInner {...props} briefing={briefing} analysisStorageKey={analysisStorageKey} />
    </ResumeWorkspaceProvider>
  )
}

const InterviewAnalysisPanel = forwardRef<AgentPanelHandle, {
  briefing: string
}>(function InterviewAnalysisPanel({ briefing }, ref) {
  const analysisWs = useResumeWorkspace()
  const { setAgentOpen, setJd, setMode } = analysisWs

  useEffect(() => {
    setMode("interviewAnalysis")
    setAgentOpen(true)
  }, [setAgentOpen, setMode])

  useEffect(() => {
    if (briefing) setJd(briefing)
  }, [briefing, setJd])

  return <AgentPanel ref={ref} lockedMode="interviewAnalysis" hideSessionControls workspace={analysisWs} />
})

function CareerInner({
  mode,
  entryId,
  initialData,
  onBack,
  briefing,
  analysisStorageKey,
}: CareerWorkspaceProps & { briefing?: string; analysisStorageKey?: string }) {
  const ws = useResumeWorkspace()
  const profile = AGENT_PROFILES[mode]
  const briefingReadRef = useRef(false)
  const briefingRef = useRef(briefing || "")
  const freshJdSessionRef = useRef(false)
  const skipFirstSaveRef = useRef(true)
  const analysisPanelRef = useRef<AgentPanelHandle | null>(null)
  const { toast } = useToast()
  const router = useRouter()
  const [variantDialogOpen, setVariantDialogOpen] = useState(false)
  const [variantTitle, setVariantTitle] = useState("")
  const [savingVariant, setSavingVariant] = useState(false)

  const { resumeData } = ws
  const kickoff = ws.kickoff
  const hydrated = ws.hydrated
  const turnCount = ws.turns.length
  const newSession = ws.newSession
  const setAgentOpen = ws.setAgentOpen
  const setJd = ws.setJd
  const setMode = ws.setMode
  const setKickoff = ws.setKickoff
  const variantParent = useMemo(
    () => ({
      id: resumeData.parentResumeId || entryId,
      title: resumeData.parentResumeTitle || initialData.parentResumeTitle || initialData.title || resumeData.title || "未命名",
    }),
    [entryId, initialData.parentResumeTitle, initialData.title, resumeData.parentResumeId, resumeData.parentResumeTitle, resumeData.title],
  )
  const defaultVariantTitle = useMemo(
    () => buildJdVariantTitle(variantParent.title || resumeData.title || "我的简历"),
    [resumeData.title, variantParent.title],
  )

  const openVariantDialog = useCallback(() => {
    setVariantTitle(defaultVariantTitle)
    setVariantDialogOpen(true)
  }, [defaultVariantTitle])

  // 另存为针对该岗位的定制版本（不覆盖原简历）
  const saveAsVariant = useCallback(async () => {
    const title = variantTitle.trim()
    if (!title) {
      toast({ title: "请输入名称", description: "给这份定制简历起个名字后再保存。", variant: "destructive" })
      return
    }
    setSavingVariant(true)
    try {
      const variant = createJdVariantResumeData(resumeData, variantParent, title)
      const entry = await createEntryFromData(variant)
      stashResumeForEdit(entry)
      toast({ title: "已另存定制版", description: `「${variant.title}」已保存到我的简历` })
      setVariantDialogOpen(false)
      router.push(`/edit/${entry.id}`)
    } catch (e) {
      toast({
        title: "保存失败",
        description: e instanceof Error ? e.message : "未知错误",
        variant: "destructive",
      })
      setSavingVariant(false)
    }
  }, [resumeData, router, toast, variantTitle])

  // 读取 intake 阶段的简报，设置上下文（仅一次）
  useEffect(() => {
    if (briefingReadRef.current || typeof window === "undefined") return
    briefingReadRef.current = true
    ws.setMode(mode)
    ws.setAgentOpen(true)
    if (analysisStorageKey || mode === "discover") ws.clearSelection()
    if (briefing) {
      briefingRef.current = briefing
      ws.setJd(briefing)
    } else {
      try {
        const raw = window.sessionStorage.getItem(CAREER_BRIEFING_KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as { mode?: string; resumeId?: string; briefing?: string }
          if (parsed.mode === mode && parsed.resumeId === entryId) {
            window.sessionStorage.removeItem(CAREER_BRIEFING_KEY)
            if (parsed.briefing) {
              briefingRef.current = parsed.briefing
              ws.setJd(parsed.briefing)
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // JD 定制每次进入都开一个干净会话，避免串入上一次岗位分析上下文。
  useEffect(() => {
    if (mode !== "jd" || !hydrated || freshJdSessionRef.current) return
    freshJdSessionRef.current = true
    newSession("jd")
    setMode("jd")
    setAgentOpen(true)
    if (briefingRef.current) setJd(briefingRef.current)
    const prompt = profile.intake?.initialPrompt
    if (prompt) setKickoff(prompt)
  }, [hydrated, mode, newSession, profile.intake?.initialPrompt, setAgentOpen, setJd, setKickoff, setMode])

  // 非 JD 专注页只在全新会话首次进入时自动发起首条指令；刷新已有会话不重复注入。
  useEffect(() => {
    if (mode === "jd" || !hydrated || turnCount > 0 || kickoff) return
    const prompt = profile.initialPrompt ?? profile.intake?.initialPrompt
    if (prompt) setKickoff(prompt)
  }, [hydrated, kickoff, mode, profile.initialPrompt, profile.intake?.initialPrompt, setKickoff, turnCount])

  // 接受 AI 优化后自动回写到该简历，避免丢失（跳过首挂载的空写）
  useEffect(() => {
    if (!entryId) return
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

  const latestInterviewQuestion = useCallback(() => {
    const turns = ws.turns
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role === "assistant" && turns[i].content.trim()) return turns[i].content.trim()
      const cards = turns[i].cards || []
      for (let j = cards.length - 1; j >= 0; j--) {
        const card = cards[j] as AgentCard
        if (card.type === "interview" && card.questions.length) {
          const first = card.questions[0]
          return [
            card.currentIndex && card.total ? `第 ${card.currentIndex}/${card.total} 题` : "",
            first.kind ? `【${first.kind}】` : "",
            first.question,
          ].filter(Boolean).join(" ")
        }
      }
    }
    return "（暂未找到上一题，请结合当前面试上下文分析用户回答。）"
  }, [ws.turns])

  const onInterviewAnswer = useCallback(
    (answer: string) => {
      if (!analysisStorageKey || mode !== "interview") return
      const question = latestInterviewQuestion()
      const prompt = [
        "请分析这一轮模拟面试回答。你是左侧分析建议 Agent，不是面试官；不要继续出正式面试题。",
        "",
        "【本轮面试官问题】",
        question,
        "",
        "【用户回答】",
        answer,
        "",
        "请严格按以下结构输出（用 ### 小标题）：",
        "### 我听到的",
        "### 亮点",
        "### 待补齐",
        "### 优先改进",
        "### 可直接复述版",
        "另附一行：**五维** substance/structure/relevance/credibility/differentiation = x/x/x/x/x；**面试官可能追问** 1-2 条。",
      ].join("\n")
      analysisPanelRef.current?.send(prompt, { displayText: "模型查看了你的面试回答，正在分析这一轮表现。" })
    },
    [analysisStorageKey, latestInterviewQuestion, mode],
  )

  // 只读模式（模拟面试分析 / 岗位方向推荐）：预览不可交互，避免产生选中态污染上下文，也不出现「用 AI 优化」
  const previewInteractive = !analysisStorageKey && mode !== "discover"

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
          {mode === "jd" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={openVariantDialog}
              className="hidden gap-2 bg-transparent md:inline-flex"
              title="把当前优化结果另存为针对该岗位的定制简历"
            >
              <Icon icon="mdi:content-save-plus-outline" className="h-4 w-4" /> 另存定制版
            </Button>
          ) : null}
          <ExportButton resumeData={resumeData} size="sm" />
        </div>
      </div>

      <div className={`career-body ${analysisStorageKey ? "career-body-interview" : ""}`}>
        {analysisStorageKey ? (
          <ResumeWorkspaceProvider initialData={initialData} storageKey={analysisStorageKey}>
            <InterviewAnalysisPanel ref={analysisPanelRef} briefing={briefing || ""} />
          </ResumeWorkspaceProvider>
        ) : null}
        <div className="rw-preview">
          <div className="p-4">
            <ResumePreview
              resumeData={resumeData}
              interactive={previewInteractive}
              selectedId={previewInteractive ? ws.selection?.id ?? null : null}
              highlightedIds={ws.highlightedIds}
              onSelect={previewInteractive ? ws.setSelection : undefined}
              onRequestAI={previewInteractive ? onRequestAI : undefined}
            />
          </div>
        </div>
        <AgentPanel lockedMode={mode} onUserTurnComplete={onInterviewAnswer} />
      </div>

      <Dialog
        open={variantDialogOpen}
        onOpenChange={(open) => {
          if (!savingVariant) setVariantDialogOpen(open)
        }}
      >
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void saveAsVariant()
            }}
          >
            <DialogHeader>
              <DialogTitle>命名定制简历</DialogTitle>
              <DialogDescription>这会创建一份新的简历，不覆盖当前原简历。</DialogDescription>
            </DialogHeader>

            <div className="grid gap-2">
              <Label htmlFor="variant-title">简历名称</Label>
              <Input
                id="variant-title"
                value={variantTitle}
                onChange={(event) => setVariantTitle(event.target.value)}
                placeholder="例如：孙荣森 - AI 产品经理定制版"
                autoFocus
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={savingVariant}
                onClick={() => setVariantDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" className="brand-gradient-bg border-0" disabled={savingVariant || !variantTitle.trim()}>
                {savingVariant ? (
                  <>
                    <Icon icon="mdi:loading" className="agent-spin h-3.5 w-3.5" /> 保存中
                  </>
                ) : (
                  "保存并打开"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
