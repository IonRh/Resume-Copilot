"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
// Avoid Radix Avatar/Checkbox to prevent extra deps; use basic elements
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Icon } from "@iconify/react"
import { useToast } from "@/hooks/use-toast"
import type { ResumeData, StoredResume } from "@/types/resume"
import { createEntryFromData, deleteResumes, getAllResumes, getCachedResumes, loadDefaultTemplate, loadExampleTemplate } from "@/lib/storage"
import { createDefaultResumeData } from "@/lib/utils"
import {
  getResumeParentId,
  getResumeVariantLabel,
  normalizeResumeTitle,
  parseResumeVariantTitle,
} from "@/lib/resume-relations"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import ExportButton from "@/components/export-button"
import CareerIntakeDialog from "@/components/agent/career-intake-dialog"
import CareerCopilot from "@/components/agent/career-copilot"
import type { CopilotAction } from "@/lib/agent/copilot"

type SortKey = "name" | "createdAt" | "updatedAt"
type SortDir = "asc" | "desc"

const POLISH_PROMPT =
  "请通读我的简历，先给出整体优化建议，再针对每段经历逐句润色，突出量化成果与影响，所有改动用 diff 形式给我确认。"

type ResumeFamily = {
  id: string
  parent: StoredResume
  variants: StoredResume[]
  createdAt: number
  latestUpdatedAt: number
}

type VisibleResumeFamily = ResumeFamily & {
  visibleVariants: StoredResume[]
}

function timeOf(value?: string): number {
  const time = value ? new Date(value).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

function titleOf(entry: StoredResume): string {
  return entry.resumeData.title || "未命名"
}

function isVariantResume(entry: StoredResume): boolean {
  return entry.resumeData.resumeKind === "jdVariant" || !!getResumeParentId(entry.resumeData) || !!parseResumeVariantTitle(entry.resumeData.title)
}

function collectRichText(value: unknown, bucket: string[]) {
  if (!value || typeof value !== "object") return
  const node = value as { text?: unknown; content?: unknown }
  if (typeof node.text === "string") bucket.push(node.text)
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => collectRichText(child, bucket))
  }
}

function comparableResumeText(data: ResumeData): string {
  const bucket: string[] = [data.title || ""]
  data.personalInfoSection?.personalInfo?.forEach((item) => {
    bucket.push(item.label, item.value?.content || "", item.value?.title || "")
  })
  data.jobIntentionSection?.items?.forEach((item) => bucket.push(item.label, item.value || ""))
  data.modules?.forEach((module) => {
    bucket.push(module.title)
    module.rows?.forEach((row) => {
      row.tags?.forEach((tag) => bucket.push(tag))
      row.elements?.forEach((element) => collectRichText(element.content, bucket))
    })
  })
  return bucket.join("").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 6000)
}

function gramSet(text: string): Set<string> {
  if (text.length <= 2) return new Set(text ? [text] : [])
  const grams = new Set<string>()
  for (let i = 0; i < text.length - 1; i += 1) {
    grams.add(text.slice(i, i + 2))
  }
  return grams
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  const base = Math.min(a.size, b.size)
  if (base === 0) return 0
  let hits = 0
  a.forEach((gram) => {
    if (b.has(gram)) hits += 1
  })
  return hits / base
}

function compareEntries(a: StoredResume, b: StoredResume, sortKey: SortKey, sortDir: SortDir): number {
  if (sortKey === "name") {
    const value = titleOf(a).localeCompare(titleOf(b), "zh-CN")
    return sortDir === "asc" ? value : -value
  }
  const field = sortKey === "createdAt" ? "createdAt" : "updatedAt"
  const value = timeOf(a[field]) - timeOf(b[field])
  return sortDir === "asc" ? value : -value
}

function compareFamilies(a: ResumeFamily, b: ResumeFamily, sortKey: SortKey, sortDir: SortDir): number {
  if (sortKey === "name") {
    const value = titleOf(a.parent).localeCompare(titleOf(b.parent), "zh-CN")
    return sortDir === "asc" ? value : -value
  }
  const value = sortKey === "createdAt" ? a.createdAt - b.createdAt : a.latestUpdatedAt - b.latestUpdatedAt
  return sortDir === "asc" ? value : -value
}

function buildResumeFamilies(entries: StoredResume[]): ResumeFamily[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const families = new Map<string, ResumeFamily>()
  const assigned = new Set<string>()
  const textCache = new Map<string, Set<string>>()

  const gramsFor = (entry: StoredResume) => {
    const cached = textCache.get(entry.id)
    if (cached) return cached
    const grams = gramSet(comparableResumeText(entry.resumeData))
    textCache.set(entry.id, grams)
    return grams
  }

  const ensureFamily = (parent: StoredResume) => {
    const existing = families.get(parent.id)
    if (existing) return existing
    const family: ResumeFamily = {
      id: parent.id,
      parent,
      variants: [],
      createdAt: timeOf(parent.createdAt),
      latestUpdatedAt: timeOf(parent.updatedAt),
    }
    families.set(parent.id, family)
    return family
  }

  entries.forEach((entry) => {
    if (!isVariantResume(entry)) ensureFamily(entry)
  })

  const attach = (variant: StoredResume, parent: StoredResume) => {
    if (variant.id === parent.id) return false
    const family = ensureFamily(parent)
    if (!family.variants.some((item) => item.id === variant.id)) {
      family.variants.push(variant)
    }
    family.latestUpdatedAt = Math.max(family.latestUpdatedAt, timeOf(variant.updatedAt))
    assigned.add(variant.id)
    return true
  }

  entries.forEach((entry) => {
    const parentId = getResumeParentId(entry.resumeData)
    if (!parentId) return
    const parent = byId.get(parentId)
    if (parent) attach(entry, parent)
  })

  entries.forEach((entry) => {
    if (assigned.has(entry.id) || !isVariantResume(entry)) return
    const parsed = parseResumeVariantTitle(entry.resumeData.title)
    const parentTitle = parsed?.baseTitle || entry.resumeData.parentResumeTitle
    if (!parentTitle) return
    const normalizedParentTitle = normalizeResumeTitle(parentTitle)
    let best: { entry: StoredResume; score: number } | null = null

    for (const candidate of entries) {
      if (candidate.id === entry.id || isVariantResume(candidate)) continue
      const normalizedCandidateTitle = normalizeResumeTitle(candidate.resumeData.title)
      if (!normalizedCandidateTitle) continue

      let score = normalizedCandidateTitle === normalizedParentTitle ? 100 : 0
      if (score === 0 && normalizedCandidateTitle.includes(normalizedParentTitle)) score = 45
      if (score === 0) continue

      score += overlapScore(gramsFor(entry), gramsFor(candidate)) * 40
      if (timeOf(candidate.createdAt) <= timeOf(entry.createdAt)) score += 4
      const daysApart = Math.abs(timeOf(entry.createdAt) - timeOf(candidate.updatedAt)) / 86400000
      score += Math.max(0, 6 - Math.min(6, daysApart))

      if (!best || score > best.score) best = { entry: candidate, score }
    }

    if (best && best.score >= 90) attach(entry, best.entry)
  })

  entries.forEach((entry) => {
    if (!assigned.has(entry.id) && !families.has(entry.id)) ensureFamily(entry)
  })

  return Array.from(families.values()).map((family) => ({
    ...family,
    variants: [...family.variants].sort((a, b) => compareEntries(a, b, "updatedAt", "desc")),
    latestUpdatedAt: Math.max(
      timeOf(family.parent.updatedAt),
      ...family.variants.map((variant) => timeOf(variant.updatedAt)),
    ),
  }))
}

export default function UserCenter() {
  const router = useRouter()
  const { toast } = useToast()

  const [items, setItems] = useState<StoredResume[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [keyword, setKeyword] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  // 默认进入加载态；真正挂载后若已有缓存，则立即展示并在后台刷新
  const [loading, setLoading] = useState(true)
  const [hydrated, setHydrated] = useState(false)
  const [intake, setIntake] = useState<{ open: boolean; mode: "jd" | "interview"; resumeId?: string }>({
    open: false,
    mode: "jd",
  })
  const [polishDialogOpen, setPolishDialogOpen] = useState(false)
  const [polishResumeId, setPolishResumeId] = useState<string | undefined>(undefined)
  const [discoverDialogOpen, setDiscoverDialogOpen] = useState(false)
  const [discoverResumeId, setDiscoverResumeId] = useState<string | undefined>(undefined)
  const [collapsedFamilies, setCollapsedFamilies] = useState<Set<string>>(new Set())

  const refresh = useCallback(() => {
    let cancelled = false
    // 已有数据（来自缓存或上次结果）时，后台静默刷新，不再清屏显示加载占位
    setLoading((prev) => (items.length === 0 ? true : prev))
    void getAllResumes()
      .then((list) => {
        if (!cancelled) setItems(list)
      })
      .catch((e) => {
        if (!cancelled) {
          toast({ title: "读取失败", description: e instanceof Error ? e.message : "无法读取后台简历" })
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [items.length, toast])

  // 客户端挂载后先用缓存即时渲染，避免回到首页时白屏等待
  useEffect(() => {
    const cached = getCachedResumes()
    if (cached && cached.length > 0) {
      setItems(cached)
      setLoading(false)
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    return refresh()
    // 仅在水合完成后触发一次后台刷新；refresh 自身依赖 items.length 但这里不需要随之重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])

  // 轻量预取新建/示例模板，提升后续进入编辑页的首屏速度
  useEffect(() => {
    // 忽略结果，仅触发浏览器缓存
    loadDefaultTemplate()
    loadExampleTemplate()
  }, [])

  const resumeFamilies = useMemo(() => buildResumeFamilies(items), [items])
  const variantCount = useMemo(
    () => resumeFamilies.reduce((sum, family) => sum + family.variants.length, 0),
    [resumeFamilies],
  )

  const visibleFamilies = useMemo<VisibleResumeFamily[]>(() => {
    const needle = keyword.trim().toLowerCase()
    const matches = (entry: StoredResume) =>
      !needle ||
      titleOf(entry).toLowerCase().includes(needle) ||
      getResumeVariantLabel(entry.resumeData).toLowerCase().includes(needle)

    return resumeFamilies
      .map((family) => {
        const parentMatches = matches(family.parent)
        const matchingVariants = family.variants.filter(matches)
        if (!parentMatches && matchingVariants.length === 0) return null
        return {
          ...family,
          visibleVariants: parentMatches ? family.variants : matchingVariants,
        }
      })
      .filter((family): family is VisibleResumeFamily => Boolean(family))
      .sort((a, b) => compareFamilies(a, b, sortKey, sortDir))
  }, [resumeFamilies, keyword, sortKey, sortDir])

  const visibleResumeIds = useMemo(
    () => visibleFamilies.flatMap((family) => [family.parent.id, ...family.visibleVariants.map((variant) => variant.id)]),
    [visibleFamilies],
  )

  const SortArrows = ({ field }: { field: SortKey }) => {
    const activeAsc = sortKey === field && sortDir === "asc"
    const activeDesc = sortKey === field && sortDir === "desc"
    return (
      <span className="inline-flex flex-col items-center justify-center ml-1 border rounded px-0.5 py-px text-[10px] leading-none">
        <Icon
          icon="mdi:triangle"
          className={`w-2.5 h-2.5 cursor-pointer ${activeAsc ? "text-blue-500" : "text-muted-foreground/50"}`}
          onClick={() => { setSortKey(field); setSortDir("asc") }}
        />
        <Icon
          icon="mdi:triangle-down"
          className={`w-2.5 h-2.5 cursor-pointer ${activeDesc ? "text-blue-500" : "text-muted-foreground/50"}`}
          onClick={() => { setSortKey(field); setSortDir("desc") }}
        />
      </span>
    )
  }

  const toggleSelect = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleSelectAll = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) visibleResumeIds.forEach((id) => next.add(id))
      else visibleResumeIds.forEach((id) => next.delete(id))
      return next
    })
  }

  // 将初始化数据预加载并写入 sessionStorage，然后再跳转，避免在新页面内数据“闪变”
  const prefetchAndOpenNew = async (type: "default" | "example") => {
    try {
      const tpl = type === "example" ? await loadExampleTemplate() : await loadDefaultTemplate()
      const data = tpl ?? createDefaultResumeData()
      if (typeof window !== "undefined") {
        try { sessionStorage.setItem("new-edit-initial-data", JSON.stringify(data)) } catch { }
      }
    } finally {
      router.push(`/edit/new`)
    }
  }

  const handleCreate = () => {
    setCreateOpen(true)
  }

  // 从零开始：沿用空白模板编辑器流程
  const handleCreateFromScratch = () => {
    setCreateOpen(false)
    void prefetchAndOpenNew("default")
  }

  // 先和 AI 聊聊：立即创建一份处于对话创建阶段的简历，并绑定唯一会话进入对话页
  const handleCreateWithAI = async () => {
    setCreateOpen(false)
    try {
      const tpl = await loadDefaultTemplate()
      const data: ResumeData = { ...(tpl ?? createDefaultResumeData()), buildMode: true }
      const entry = await createEntryFromData(data)
      router.push(`/create/${entry.id}`)
    } catch (e) {
      toast({
        title: "创建失败",
        description: e instanceof Error ? e.message : "未知错误",
        variant: "destructive",
      })
    }
  }

  const handleClone = (id: string) => {
    // 不立即保存，带上 cloneId 进入新建编辑页
    router.push(`/edit/new?clone=${encodeURIComponent(id)}`)
  }

  const handleCreateVariant = (id: string) => {
    router.push(`/edit/new?clone=${encodeURIComponent(id)}&variant=jd`)
  }

  const toggleFamilyCollapsed = (id: string) => {
    setCollapsedFamilies((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 最近更新的一份简历，作为求职工具的默认操作对象
  const mostRecent = useMemo(
    () =>
      [...items].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )[0],
    [items],
  )

  const resumeChoices = useMemo(
    () =>
      [...items].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [items],
  )

  const openPolishDialog = useCallback(
    () => {
      if (!mostRecent) {
        toast({ title: "还没有简历", description: "请先创建一份简历，再使用求职工具。" })
        return
      }
      setPolishResumeId(mostRecent.id)
      setPolishDialogOpen(true)
    },
    [mostRecent, toast],
  )

  // 进入指定简历的润色工作区：写入待办指令后跳转
  const runPolish = useCallback(
    (id: string) => {
      try {
        sessionStorage.setItem("agent-kickoff", JSON.stringify({ prompt: POLISH_PROMPT }))
      } catch {
        /* sessionStorage 不可用时仍正常进入编辑页 */
      }
      router.push(`/edit/${id}`)
    },
    [router],
  )

  // 简历润色入口：先选简历，再把待办指令写入 sessionStorage 并进入工作区
  const startPolish = useCallback(
    () => {
      const id = polishResumeId || mostRecent?.id
      if (!id) {
        toast({ title: "请选择简历", description: "选择一份简历后再进入润色。" })
        return
      }
      setPolishDialogOpen(false)
      runPolish(id)
    },
    [mostRecent?.id, polishResumeId, runPolish, toast],
  )

  // 岗位方向推荐：先选简历，再进入专注工作台，由 AI 反推适合的方向
  const openDiscoverDialog = useCallback(() => {
    if (!mostRecent) {
      toast({ title: "还没有简历", description: "请先创建一份简历，再使用岗位方向推荐。" })
      return
    }
    setDiscoverResumeId(mostRecent.id)
    setDiscoverDialogOpen(true)
  }, [mostRecent, toast])

  const startDiscover = useCallback(() => {
    const id = discoverResumeId || mostRecent?.id
    if (!id) {
      toast({ title: "请选择简历", description: "选择一份简历后再进入方向推荐。" })
      return
    }
    setDiscoverDialogOpen(false)
    router.push(`/career/discover/${id}`)
  }, [discoverResumeId, mostRecent?.id, router, toast])

  // JD 匹配 / 模拟面试：先经「选简历 + 对话收集」模态框，再进入专注工作台
  const openIntake = useCallback(
    (mode: "jd" | "interview", resumeId?: string) => {
      if (!mostRecent) {
        toast({ title: "还没有简历", description: "请先创建一份简历，再使用求职工具。" })
        return
      }
      setIntake({ open: true, mode, resumeId })
    },
    [mostRecent, toast],
  )

  // 求职管家：把行动意图映射到现有入口（全部复用，零新逻辑）
  const handleCopilotAction = useCallback(
    (action: CopilotAction) => {
      switch (action.kind) {
        case "create_resume":
          setCreateOpen(true)
          break
        case "applications":
          router.push("/applications")
          break
        case "polish":
          if (action.resumeId) runPolish(action.resumeId)
          break
        case "discover":
          if (action.resumeId) router.push(`/career/discover/${action.resumeId}`)
          break
        case "jd_match":
          if (action.resumeId) openIntake("jd", action.resumeId)
          break
        case "interview":
          router.push(action.resumeId ? `/interviews?resume=${encodeURIComponent(action.resumeId)}` : "/interviews")
          break
        case "edit_resume":
          if (action.resumeId) {
            const target = items.find((it) => it.id === action.resumeId)
            router.push(target?.resumeData.buildMode ? `/create/${action.resumeId}` : `/edit/${action.resumeId}`)
          }
          break
      }
    },
    [items, openIntake, router, runPolish],
  )

  const handleDelete = async (ids: string[]) => {
    try {
      await deleteResumes(ids)
      toast({ title: "删除成功", description: `已删除 ${ids.length} 条简历` })
      setSelected(new Set())
      refresh()
    } catch (e) {
      toast({ title: "删除失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    }
  }

  const allVisibleSelected = visibleResumeIds.length > 0 && visibleResumeIds.every((id) => selected.has(id))

  return (
    <div className="min-h-screen bg-background">
      {/* AI 求职工具路口 */}
      <div className="p-4 pb-0">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: "mdi:compass-outline",
              title: "岗位方向推荐",
              desc: "基于简历反推你适合投递的方向",
              action: openDiscoverDialog,
            },
            {
              icon: "mdi:auto-fix",
              title: "AI 简历润色",
              desc: "先选择简历，再逐句润色并量化成果",
              action: openPolishDialog,
            },
            {
              icon: "mdi:target",
              title: "JD 匹配优化",
              desc: "选择简历，对话给出 JD，进入专注工作台",
              action: () => openIntake("jd"),
            },
            {
              icon: "mdi:account-voice",
              title: "模拟面试",
              desc: "查看历史记录，发起新一轮模拟面试",
              action: () => router.push("/interviews"),
            },
          ].map((tool) => (
            <button
              key={tool.title}
              onClick={tool.action}
              className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
            >
              <span className="brand-gradient-bg grid h-10 w-10 shrink-0 place-items-center rounded-xl">
                <Icon icon={tool.icon} className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-sm font-semibold">
                  {tool.title}
                  <Icon
                    icon="mdi:arrow-right"
                    className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                  />
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{tool.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-3">
          <Icon icon="mdi:account" className="w-6 h-6 text-primary" />
          <h1 className="text-lg font-semibold">我的简历</h1>
          <Badge variant="secondary">{resumeFamilies.length} 组</Badge>
          {variantCount > 0 ? <Badge variant="outline">{variantCount} 份 JD 子简历</Badge> : null}
        </div>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <>
              <Input
                placeholder="搜索简历名称"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="w-56"
              />
              <Separator orientation="vertical" className="h-6" />
            </>
          )}
          <Button variant="outline" className="gap-2" onClick={() => router.push("/applications")}>
            <Icon icon="mdi:briefcase-check-outline" className="w-4 h-4" /> 投递管理
          </Button>
          {items.length > 0 && (
            <>
            <Button onClick={handleCreate} className="gap-2">
              <Icon icon="mdi:plus" className="w-4 h-4" /> 创建简历
            </Button>
            <Button
              variant="destructive"
              className="gap-2"
              disabled={selected.size === 0}
              onClick={() => setConfirmOpen(true)}
            >
              <Icon icon="mdi:trash-can" className="w-4 h-4" /> 批量删除
            </Button>
            </>
          )}
        </div>
      </div>

      <Separator />

      {/* 列表（表格） */}
      <div className="p-4 space-y-3">
        {items.length > 0 && (
          <div className="flex items-center gap-3 px-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border"
              checked={allVisibleSelected}
              onChange={(e) => toggleSelectAll(e.target.checked)}
            />
            <span className="text-sm text-muted-foreground">
              已选 {selected.size} 项
              {keyword.trim() ? `，当前筛选 ${visibleResumeIds.length} 项` : ""}
            </span>
          </div>
        )}
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">正在读取简历...</div>
        ) : visibleFamilies.length === 0 ? (
          <div className="py-16">
            <div className="mx-auto max-w-xl text-center rounded-xl border bg-muted/30 p-10 shadow-sm">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <Icon icon="mdi:file-document-edit" className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold">{items.length === 0 ? "暂无简历" : "没有匹配的简历"}</h3>
              <div className="mt-2 inline-flex flex-col items-stretch">
                <p className="text-sm text-muted-foreground">
                  {items.length === 0 ? "点击“创建简历”开始，后台会自动保存你的简历数据" : "换个关键词，或清空搜索后查看全部母子简历"}
                </p>
                <div className="mt-6 flex items-center justify-between">
                  <Button onClick={handleCreate} className="gap-2 shrink-0">
                    <Icon icon="mdi:plus" className="w-4 h-4" /> 创建简历
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2 shrink-0"
                    onClick={() => prefetchAndOpenNew("example")}
                  >
                    <Icon icon="mdi:lightbulb-on" className="w-4 h-4" /> 示例
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead className="text-center">层级</TableHead>
                <TableHead className="text-center">头像</TableHead>
                <TableHead>
                  <div className="flex items-center justify-start">名称 <SortArrows field="name" /></div>
                </TableHead>
                <TableHead className="text-center">
                  <div className="flex items-center justify-center">创建时间 <SortArrows field="createdAt" /></div>
                </TableHead>
                <TableHead className="text-center">
                  <div className="flex items-center justify-center">更新时间 <SortArrows field="updatedAt" /></div>
                </TableHead>
                <TableHead className="text-center w-[430px]">
                  <div className="flex items-center justify-center">操作</div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleFamilies.map((family) => {
                const collapsed = collapsedFamilies.has(family.id) && !keyword.trim()
                const childRows = collapsed ? [] : family.visibleVariants
                const parent = family.parent
                return (
                  <Fragment key={family.id}>
                    <TableRow className="bg-muted/20 hover:bg-muted/40">
                      <TableCell>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border"
                          checked={selected.has(parent.id)}
                          onChange={(e) => toggleSelect(parent.id, e.target.checked)}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={family.visibleVariants.length === 0}
                            onClick={() => toggleFamilyCollapsed(family.id)}
                            title={collapsed ? "展开子简历" : "收起子简历"}
                          >
                            <Icon icon={collapsed ? "mdi:chevron-right" : "mdi:chevron-down"} className="h-4 w-4" />
                          </Button>
                          <Badge variant="secondary" className="gap-1">
                            <Icon icon="mdi:file-account-outline" className="h-3 w-3" />
                            母
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="h-10 w-10 rounded-full overflow-hidden bg-muted flex items-center justify-center mx-auto">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={parent.resumeData.avatar || "/not-set.png"}
                            alt={titleOf(parent)}
                            className="h-full w-full object-cover"
                            onError={(ev) => { (ev.currentTarget as HTMLImageElement).src = "/default-avatar.jpg" }}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-semibold">{titleOf(parent)}</span>
                          <Badge variant="outline">{family.variants.length} 子</Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          编号 {parent.id.slice(0, 8)}
                          {family.variants.length > 0 ? ` · 最近子简历更新 ${new Date(family.latestUpdatedAt).toLocaleString()}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-center">{new Date(parent.createdAt).toLocaleString()}</TableCell>
                      <TableCell className="text-xs text-center">{new Date(parent.updatedAt).toLocaleString()}</TableCell>
                      <TableCell className="text-right w-[430px]">
                        <div className="flex items-center gap-2 justify-end">
                          <Button variant="ghost" className="gap-2" onClick={() => router.push(`/view/${parent.id}`)}>
                            <Icon icon="mdi:eye" className="w-4 h-4" /> 查看
                          </Button>
                          <ExportButton resumeData={parent.resumeData} variant="ghost" />
                          {parent.resumeData.buildMode ? (
                            <Button variant="ghost" className="gap-2" onClick={() => router.push(`/create/${parent.id}`)}>
                              <Icon icon="mdi:robot-happy-outline" className="w-4 h-4" /> 继续聊聊
                            </Button>
                          ) : (
                            <Button variant="ghost" className="gap-2" onClick={() => router.push(`/edit/${parent.id}`)}>
                              <Icon icon="mdi:pencil" className="w-4 h-4" /> 编辑
                            </Button>
                          )}
                          <Button variant="ghost" className="gap-2" onClick={() => handleCreateVariant(parent.id)}>
                            <Icon icon="mdi:file-tree" className="w-4 h-4" /> JD 子版
                          </Button>
                          <Button variant="ghost" className="gap-2" onClick={() => handleClone(parent.id)}>
                            <Icon icon="mdi:content-copy" className="w-4 h-4" /> 克隆
                          </Button>
                          <Button
                            variant="ghost"
                            className="gap-2 hover:bg-destructive hover:text-white"
                            onClick={() => { setSelected(new Set([parent.id])); setConfirmOpen(true) }}
                          >
                            <Icon icon="mdi:delete" className="w-4 h-4" /> 删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>

                    {childRows.map((it) => (
                      <TableRow key={it.id} className="bg-background/60 hover:bg-muted/30">
                        <TableCell>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border"
                            checked={selected.has(it.id)}
                            onChange={(e) => toggleSelect(it.id, e.target.checked)}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                            <span className="h-px w-5 bg-border" />
                            <Badge variant="outline" className="gap-1">
                              <Icon icon="mdi:target" className="h-3 w-3" />
                              子
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="h-9 w-9 rounded-full overflow-hidden bg-muted flex items-center justify-center mx-auto opacity-90">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={it.resumeData.avatar || parent.resumeData.avatar || "/not-set.png"}
                              alt={titleOf(it)}
                              className="h-full w-full object-cover"
                              onError={(ev) => { (ev.currentTarget as HTMLImageElement).src = "/default-avatar.jpg" }}
                            />
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex min-w-0 items-center gap-2 pl-3">
                            <Icon icon="mdi:subdirectory-arrow-right" className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate font-medium">{titleOf(it)}</span>
                            <Badge variant="outline">{getResumeVariantLabel(it.resumeData)}</Badge>
                          </div>
                          <div className="mt-1 pl-10 text-xs text-muted-foreground">
                            归属 {titleOf(parent)} · 编号 {it.id.slice(0, 8)}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-center">{new Date(it.createdAt).toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-center">{new Date(it.updatedAt).toLocaleString()}</TableCell>
                        <TableCell className="text-right w-[430px]">
                          <div className="flex items-center gap-2 justify-end">
                            <Button variant="ghost" className="gap-2" onClick={() => router.push(`/view/${it.id}`)}>
                              <Icon icon="mdi:eye" className="w-4 h-4" /> 查看
                            </Button>
                            <ExportButton resumeData={it.resumeData} variant="ghost" />
                            {it.resumeData.buildMode ? (
                              <Button variant="ghost" className="gap-2" onClick={() => router.push(`/create/${it.id}`)}>
                                <Icon icon="mdi:robot-happy-outline" className="w-4 h-4" /> 继续聊聊
                              </Button>
                            ) : (
                              <Button variant="ghost" className="gap-2" onClick={() => router.push(`/edit/${it.id}`)}>
                                <Icon icon="mdi:pencil" className="w-4 h-4" /> 编辑
                              </Button>
                            )}
                            <Button variant="ghost" className="gap-2" onClick={() => handleClone(it.id)}>
                              <Icon icon="mdi:content-copy" className="w-4 h-4" /> 克隆
                            </Button>
                            <Button
                              variant="ghost"
                              className="gap-2 hover:bg-destructive hover:text-white"
                              onClick={() => { setSelected(new Set([it.id])); setConfirmOpen(true) }}
                            >
                              <Icon icon="mdi:delete" className="w-4 h-4" /> 删除
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* JD 匹配 / 模拟面试 意图收集 */}
      <CareerIntakeDialog
        open={intake.open}
        mode={intake.mode}
        resumes={items}
        defaultResumeId={intake.resumeId ?? mostRecent?.id}
        onOpenChange={(o) => setIntake((s) => ({ ...s, open: o }))}
      />

      {/* 创建简历：选择创建方式 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>创建简历</DialogTitle>
            <DialogDescription>选择一种方式开始，后台会自动保存你的简历数据。</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={handleCreateFromScratch}
              className="group flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/60 hover:bg-muted/40"
            >
              <span className="grid h-11 w-11 place-items-center rounded-lg bg-muted text-primary">
                <Icon icon="mdi:file-document-outline" className="h-6 w-6" />
              </span>
              <span className="text-sm font-semibold">从零开始</span>
              <span className="text-xs text-muted-foreground">打开空白模板，自己动手逐项填写与排版。</span>
            </button>

            <button
              type="button"
              onClick={() => void handleCreateWithAI()}
              className="group flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/60 hover:bg-muted/40"
            >
              <span className="brand-gradient-bg grid h-11 w-11 place-items-center rounded-lg">
                <Icon icon="mdi:robot-happy-outline" className="h-6 w-6" />
              </span>
              <span className="text-sm font-semibold">先和 AI 聊聊</span>
              <span className="text-xs text-muted-foreground">和创建助手对话，由 AI 引导你从零搭建整份简历。</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI 简历润色：先选择简历 */}
      <Dialog open={polishDialogOpen} onOpenChange={setPolishDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              startPolish()
            }}
          >
            <DialogHeader>
              <DialogTitle>选择要润色的简历</DialogTitle>
              <DialogDescription>进入对应简历工作区后，AI 会自动开始整体润色。</DialogDescription>
            </DialogHeader>

            <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {resumeChoices.map((it) => {
                const active = polishResumeId === it.id
                return (
                  <button
                    key={it.id}
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-primary/50 hover:bg-muted/40"
                    }`}
                    onClick={() => setPolishResumeId(it.id)}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted">
                      <Icon icon="mdi:file-document-edit-outline" className="h-4 w-4 text-primary" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{it.resumeData.title || "未命名"}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        更新于 {new Date(it.updatedAt).toLocaleString()}
                      </span>
                    </span>
                    <Icon
                      icon={active ? "mdi:radiobox-marked" : "mdi:radiobox-blank"}
                      className={`h-5 w-5 ${active ? "text-primary" : "text-muted-foreground"}`}
                    />
                  </button>
                )
              })}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPolishDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" className="brand-gradient-bg border-0" disabled={!polishResumeId}>
                <Icon icon="mdi:auto-fix" className="h-4 w-4" /> 进入润色
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 岗位方向推荐：先选择简历 */}
      <Dialog open={discoverDialogOpen} onOpenChange={setDiscoverDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              startDiscover()
            }}
          >
            <DialogHeader>
              <DialogTitle>选择要分析的简历</DialogTitle>
              <DialogDescription>进入工作台后，AI 会基于这份简历反推适合你投递的岗位方向。</DialogDescription>
            </DialogHeader>

            <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {resumeChoices.map((it) => {
                const active = discoverResumeId === it.id
                return (
                  <button
                    key={it.id}
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-primary/50 hover:bg-muted/40"
                    }`}
                    onClick={() => setDiscoverResumeId(it.id)}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted">
                      <Icon icon="mdi:file-document-edit-outline" className="h-4 w-4 text-primary" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{it.resumeData.title || "未命名"}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        更新于 {new Date(it.updatedAt).toLocaleString()}
                      </span>
                    </span>
                    <Icon
                      icon={active ? "mdi:radiobox-marked" : "mdi:radiobox-blank"}
                      className={`h-5 w-5 ${active ? "text-primary" : "text-muted-foreground"}`}
                    />
                  </button>
                )
              })}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDiscoverDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" className="brand-gradient-bg border-0" disabled={!discoverResumeId}>
                <Icon icon="mdi:compass-outline" className="h-4 w-4" /> 开始推荐
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除所选简历？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可撤销，删除后后台将不再保留这些简历。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                handleDelete(Array.from(selected))
                setConfirmOpen(false)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 右下角常驻「求职管家」Copilot */}
      <CareerCopilot resumes={items} onAction={handleCopilotAction} />
    </div>
  )
}
