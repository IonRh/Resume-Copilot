"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import CoverLetterExportButton from "@/components/cover-letter-export-button"
import { useToast } from "@/hooks/use-toast"
import {
  createCoverLetter,
  deleteCoverLetterRecord,
  hasCoverLetterBody,
  loadCoverLetters,
  migrateLegacyCoverLetters,
} from "@/lib/cover-letters"
import { getAllResumes, getCachedResumes } from "@/lib/storage"
import { getResumeDisplayName } from "@/lib/resume-display"
import type { StoredResume } from "@/types/resume"
import type { CoverLetterRecord } from "@/types/cover-letter"
import { coverLetterDisplayTitle, coverLetterScenarioLabel } from "@/types/cover-letter"

function formatDateTime(iso?: string): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function CoverLetterHub() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()

  const [resumes, setResumes] = useState<StoredResume[]>([])
  const [letters, setLetters] = useState<CoverLetterRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [createResumeId, setCreateResumeId] = useState<string | undefined>()
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CoverLetterRecord | null>(null)

  const refreshLetters = useCallback(async () => {
    setLetters(await loadCoverLetters())
  }, [])

  const refresh = useCallback(() => {
    let cancelled = false
    setLoading(true)
    void getAllResumes()
      .then(async (list) => {
        if (cancelled) return
        setResumes(list)
        const titles = Object.fromEntries(list.map((item) => [item.id, getResumeDisplayName(item)]))
        const migrated = await migrateLegacyCoverLetters(titles)
        if (migrated > 0) {
          toast({ title: "已迁移历史自荐信", description: `已将 ${migrated} 份本地草稿导入记录列表。` })
        }
        await refreshLetters()
      })
      .catch((e) => {
        if (!cancelled) {
          toast({
            title: "读取失败",
            description: e instanceof Error ? e.message : "无法读取自荐信列表",
            variant: "destructive",
          })
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refreshLetters, toast])

  useEffect(() => {
    const cached = getCachedResumes()
    if (cached?.length) setResumes(cached)
    return refresh()
  }, [refresh])

  useEffect(() => {
    const resumeParam = searchParams.get("resume")
    if (resumeParam && resumes.some((item) => item.id === resumeParam)) {
      setCreateResumeId(resumeParam)
      setCreateOpen(true)
    }
  }, [resumes, searchParams])

  const mostRecent = resumes[0]

  const visibleLetters = useMemo(() => {
    const needle = keyword.trim().toLowerCase()
    if (!needle) return letters
    return letters.filter((item) => {
      const title = coverLetterDisplayTitle(item).toLowerCase()
      return (
        title.includes(needle) ||
        item.resumeTitle.toLowerCase().includes(needle) ||
        (item.draft.body || "").toLowerCase().includes(needle)
      )
    })
  }, [keyword, letters])

  const openCreate = useCallback(
    (resumeId?: string) => {
      if (!mostRecent) {
        toast({ title: "还没有简历", description: "请先创建一份简历，再撰写自荐信。" })
        return
      }
      setCreateResumeId(resumeId ?? mostRecent.id)
      setCreateOpen(true)
    },
    [mostRecent, toast],
  )

  const confirmCreate = useCallback(async () => {
    const resume = resumes.find((item) => item.id === createResumeId) || mostRecent
    if (!resume) return
    setCreating(true)
    try {
      const letter = await createCoverLetter({
        resumeId: resume.id,
        resumeTitle: getResumeDisplayName(resume),
      })
      setCreateOpen(false)
      router.push(`/cover-letters/${letter.id}`)
    } catch (e) {
      toast({
        title: "创建失败",
        description: e instanceof Error ? e.message : "未知错误",
        variant: "destructive",
      })
    } finally {
      setCreating(false)
    }
  }, [createResumeId, mostRecent, resumes, router, toast])

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    await deleteCoverLetterRecord(deleteTarget.id)
    setDeleteTarget(null)
    void refreshLetters()
    toast({ title: "已删除", description: "该份自荐信已移除。" })
  }, [deleteTarget, refreshLetters, toast])

  const withContentCount = letters.filter((item) => hasCoverLetterBody(item.draft)).length

  return (
    <div className="min-h-screen bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className="brand-gradient-bg grid h-9 w-9 place-items-center rounded-xl">
            <Icon icon="mdi:email-edit-outline" className="h-5 w-5" />
          </span>
          <h1 className="text-lg font-semibold">自荐信</h1>
          <Badge variant="secondary">{letters.length} 份记录</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2 bg-transparent" onClick={() => router.push("/resumes")}>
            <Icon icon="mdi:arrow-left" className="h-4 w-4" /> 返回
          </Button>
          <Button className="brand-gradient-bg gap-2 border-0" onClick={() => openCreate(createResumeId)}>
            <Icon icon="mdi:plus-circle-outline" className="h-4 w-4" /> 新建自荐信
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3">
        {[
          { label: "全部记录", value: letters.length, icon: "mdi:email-multiple-outline", tint: "text-blue-600" },
          { label: "已有正文", value: withContentCount, icon: "mdi:text-box-check-outline", tint: "text-emerald-600" },
          {
            label: "关联简历",
            value: new Set(letters.map((item) => item.resumeId)).size,
            icon: "mdi:file-document-outline",
            tint: "text-violet-600",
          },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border bg-card p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon icon={card.icon} className={`h-4 w-4 ${card.tint}`} />
              {card.label}
            </div>
            <div className="mt-1 text-2xl font-semibold">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Icon
            icon="mdi:magnify"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索标题、简历名称或正文…"
            className="pl-9"
          />
        </div>
      </div>

      <div className="space-y-3 px-4 pb-6">
        {loading ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            <Icon icon="mdi:loading" className="agent-spin mr-1 inline h-4 w-4" /> 加载中…
          </div>
        ) : visibleLetters.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-muted">
              <Icon icon="mdi:email-edit-outline" className="h-7 w-7 text-primary" />
            </div>
            <h2 className="mt-4 text-base font-semibold">{letters.length ? "没有匹配的记录" : "还没有自荐信"}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {letters.length ? "换个关键词试试，或新建一份自荐信。" : "选择简历后即可开始撰写，Agent 会协助你生成与调整内容。"}
            </p>
            {!letters.length ? (
              <Button className="brand-gradient-bg mt-5 gap-2 border-0" onClick={() => openCreate(createResumeId)}>
                <Icon icon="mdi:plus-circle-outline" className="h-4 w-4" /> 新建自荐信
              </Button>
            ) : null}
          </div>
        ) : (
          visibleLetters.map((letter) => {
            const title = coverLetterDisplayTitle(letter)
            const hasBody = hasCoverLetterBody(letter.draft)
            return (
              <div
                key={letter.id}
                className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/20"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold">{title}</h3>
                      <Badge variant="secondary">{coverLetterScenarioLabel(letter.draft.scenario)}</Badge>
                      {!hasBody ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          草稿
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Icon icon="mdi:file-document-outline" className="h-3.5 w-3.5" />
                        {letter.resumeTitle}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Icon icon="mdi:clock-outline" className="h-3.5 w-3.5" />
                        {formatDateTime(letter.updatedAt)}
                      </span>
                    </div>
                    {letter.draft.body?.trim() ? (
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{letter.draft.body}</p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 bg-transparent"
                      onClick={() => router.push(`/cover-letters/${letter.id}`)}
                    >
                      <Icon icon="mdi:pencil-outline" className="h-4 w-4" />
                      {hasBody ? "编辑" : "继续撰写"}
                    </Button>
                    <CoverLetterExportButton
                      title={title}
                      draft={letter.draft}
                      resumeTitle={letter.resumeTitle}
                      disabled={!hasBody}
                      className="gap-1 bg-transparent"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      title="删除"
                      onClick={() => setDeleteTarget(letter)}
                    >
                      <Icon icon="mdi:trash-can-outline" className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="flex max-h-[84vh] flex-col overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新建自荐信</DialogTitle>
            <DialogDescription>选择一份简历作为撰写依据，进入工作台后可由 Agent 协助生成与润色。</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {resumes.length ? (
              resumes.map((item) => {
                const active = createResumeId === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCreateResumeId(item.id)}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-primary/50 hover:bg-muted/40"
                    }`}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted">
                      <Icon icon="mdi:file-document-outline" className="h-4 w-4 text-primary" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{getResumeDisplayName(item)}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        更新于 {formatDateTime(item.updatedAt)}
                      </span>
                    </span>
                    <Icon
                      icon={active ? "mdi:radiobox-marked" : "mdi:radiobox-blank"}
                      className={`h-5 w-5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
                    />
                  </button>
                )
              })
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                还没有简历，请先创建一份后再撰写自荐信。
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              取消
            </Button>
            <Button
              className="brand-gradient-bg border-0"
              disabled={!createResumeId || creating || !resumes.length}
              onClick={() => void confirmCreate()}
            >
              {creating ? (
                <>
                  <Icon icon="mdi:loading" className="agent-spin h-4 w-4" /> 创建中
                </>
              ) : (
                "进入工作台"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这份自荐信？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除「{deleteTarget ? coverLetterDisplayTitle(deleteTarget) : ""}」，此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
