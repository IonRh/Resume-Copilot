"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Icon } from "@iconify/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import AgentPanel, { type AgentPanelHandle } from "@/components/agent/agent-panel"
import ExportButton from "@/components/export-button"
import ResumePreview from "@/components/resume-preview"
import { useToast } from "@/hooks/use-toast"
import { AGENT_PROFILES } from "@/lib/agent/prompts"
import { genId } from "@/lib/agent/changeset"
import { IMAGE_IMPORT_MAX_BYTES } from "@/lib/agent/image-import"
import { ResumeWorkspaceProvider, useResumeWorkspace } from "@/lib/agent/store"
import { updateEntryData } from "@/lib/storage"
import type { WorkspaceSelection } from "@/lib/agent/types"
import type { ResumeData } from "@/types/resume"

interface ImageImportWorkspaceProps {
  entryId: string
  initialData: ResumeData
  onBack?: () => void
}

const GREETING = [
  "你好，我是**图片导入助手**。",
  "",
  "请选择一张简历截图、照片或图片。我会直接查看图片内容，并调用工具把它整理到左侧可编辑简历里。",
].join("\n")

export default function ImageImportWorkspace(props: ImageImportWorkspaceProps) {
  const storageKey = `resume.image-import.${props.entryId}`
  return (
    <ResumeWorkspaceProvider initialData={props.initialData} storageKey={storageKey}>
      <ImageImportInner {...props} />
    </ResumeWorkspaceProvider>
  )
}

function ImageImportInner({ entryId, onBack }: ImageImportWorkspaceProps) {
  const ws = useResumeWorkspace()
  const router = useRouter()
  const { toast } = useToast()
  const profile = AGENT_PROFILES.imageImport
  const { resumeData } = ws
  const [finishing, setFinishing] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [note, setNote] = useState("")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const agentRef = useRef<AgentPanelHandle | null>(null)
  const greetedRef = useRef(false)
  const pickerShownRef = useRef(false)
  const skipFirstSaveRef = useRef(true)

  useEffect(() => {
    ws.setMode("imageImport")
    ws.setAgentOpen(true)
    ws.clearSelection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  useEffect(() => {
    if (!ws.hydrated || pickerShownRef.current || ws.turns.some((turn) => turn.role === "user")) return
    pickerShownRef.current = true
    setPickerOpen(true)
  }, [ws.hydrated, ws.turns])

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

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ""))
      reader.onerror = () => reject(new Error("读取图片失败"))
      reader.readAsDataURL(file)
    })

  const pickFile = (file: File | null | undefined) => {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast({ title: "文件类型不支持", description: "请上传 PNG、JPG 或 WebP 图片。", variant: "destructive" })
      return
    }
    if (file.size > IMAGE_IMPORT_MAX_BYTES) {
      toast({ title: "图片太大", description: "请上传 8MB 以内的图片。", variant: "destructive" })
      return
    }
    setSelectedFile(file)
  }

  const sendImageToAgent = useCallback(async () => {
    if (!selectedFile) return
    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)
      const prompt = [
        "请直接查看我上传的这张简历图片，把图片中的内容整理成左侧可编辑简历。",
        "要求：先识别文字和版式，再调用 replace_resume 或相关工具生成完整简历草稿；不要编造图片里没有的信息；看不清的地方在回复里标出来并追问。",
        "教育、工作、项目标题行请按多列拆分，时间列右对齐；经历详情用单列要点行。",
        note.trim() ? `补充说明：${note.trim()}` : "",
      ].filter(Boolean).join("\n")

      agentRef.current?.send(prompt, {
        displayText: `从图片导入简历：${selectedFile.name}`,
        attachments: [{ type: "image_url", image_url: { url: dataUrl, detail: "high" } }],
      })
      setPickerOpen(false)
      setSelectedFile(null)
      setNote("")
    } catch (e) {
      toast({
        title: "读取图片失败",
        description: e instanceof Error ? e.message : "未知错误",
        variant: "destructive",
      })
    }
  }, [note, selectedFile, toast])

  const handleFinish = useCallback(async () => {
    setFinishing(true)
    try {
      const next: ResumeData = { ...resumeData, buildMode: false, creationMode: undefined }
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
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)} className="gap-2 bg-transparent">
            <Icon icon="mdi:image-plus-outline" className="h-4 w-4" />
            <span className="hidden sm:inline">选择图片</span>
          </Button>
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
            title="结束图片导入，进入编辑器自己动手"
          >
            {finishing ? (
              <>
                <Icon icon="mdi:loading" className="agent-spin h-4 w-4" /> 处理中
              </>
            ) : (
              <>
                <Icon icon="mdi:check" className="h-4 w-4" /> 完成导入
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
        <AgentPanel ref={agentRef} lockedMode="imageImport" hideSessionControls />
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>从图片导入简历</DialogTitle>
            <DialogDescription>选择一张简历截图、照片或图片，图片会直接交给导入助手识别。</DialogDescription>
          </DialogHeader>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              pickFile(event.target.files?.[0])
              event.currentTarget.value = ""
            }}
          />
          <button
            type="button"
            className="flex min-h-28 items-center gap-4 rounded-xl border border-dashed border-border bg-card p-5 text-left transition-colors hover:border-primary/60 hover:bg-muted/40"
            onClick={() => inputRef.current?.click()}
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-muted text-primary">
              <Icon icon="mdi:image-plus-outline" className="h-6 w-6" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                {selectedFile ? selectedFile.name : "选择图片"}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">PNG、JPG、WebP，最大 8MB</span>
            </span>
          </button>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="可选：说明图片来源、希望保留的排版，或指出哪些信息需要特别识别"
            className="min-h-20 resize-none text-sm"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>
              取消
            </Button>
            <Button className="brand-gradient-bg border-0" disabled={!selectedFile} onClick={() => void sendImageToAgent()}>
              <Icon icon="mdi:send" className="h-4 w-4" />
              交给助手
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
