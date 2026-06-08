"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Icon } from "@iconify/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"

import type { StoredResume } from "@/types/resume"
import { getResumeDisplayName } from "@/lib/resume-display"
import type { ApplicationPriority, ApplicationStatus, JobApplication } from "@/types/application"
import {
  ACTIVE_APPLICATION_STATUSES,
  APPLICATION_STATUS_FLOW,
  getNextStatus,
  getStatusMeta,
} from "@/types/application"
import {
  createApplication as createApplicationApi,
  deleteApplications as deleteApplicationsApi,
  getAllApplications,
  updateApplication as updateApplicationApi,
  type ApplicationDraft,
} from "@/lib/applications"
import { getAllResumes, getResumeById } from "@/lib/storage"
import {
  fetchApplicationAssist,
  fetchApplicationInsights,
  type ApplicationAssistResult,
  type ApplicationInsightsReport,
} from "@/lib/application-ai"

type ViewMode = "board" | "list"

const PRIORITY_META: Record<ApplicationPriority, { label: string; className: string }> = {
  high: { label: "高", className: "bg-rose-100 text-rose-700 border-rose-200" },
  normal: { label: "中", className: "bg-slate-100 text-slate-600 border-slate-200" },
  low: { label: "低", className: "bg-zinc-100 text-zinc-500 border-zinc-200" },
}

type FormState = {
  company: string
  position: string
  location: string
  salary: string
  channel: string
  contact: string
  jdUrl: string
  jdText: string
  resumeId: string
  status: ApplicationStatus
  priority: ApplicationPriority
  appliedAt: string
  nextAction: string
  nextActionAt: string
  notes: string
}

const NONE_RESUME = "__none__"

function emptyForm(): FormState {
  return {
    company: "",
    position: "",
    location: "",
    salary: "",
    channel: "",
    contact: "",
    jdUrl: "",
    jdText: "",
    resumeId: "",
    status: "applied",
    priority: "normal",
    appliedAt: toDateInput(new Date().toISOString()),
    nextAction: "",
    nextActionAt: "",
    notes: "",
  }
}

function toDateInput(iso?: string): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function fromDateInput(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function formatDate(iso?: string): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" })
}

function resumeLabel(entry: StoredResume): string {
  return getResumeDisplayName(entry)
}

function daysUntil(iso?: string): number | null {
  if (!iso) return null
  const target = new Date(iso)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

export default function ApplicationTracker() {
  const router = useRouter()
  const { toast } = useToast()

  const [items, setItems] = useState<JobApplication[]>([])
  const [resumes, setResumes] = useState<StoredResume[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState("")
  const [view, setView] = useState<ViewMode>("board")
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">("all")

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<JobApplication | null>(null)

  // AI 复盘
  const [insightsOpen, setInsightsOpen] = useState(false)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insights, setInsights] = useState<ApplicationInsightsReport | null>(null)

  // AI 阶段助手（编辑弹窗内）
  const [assistLoading, setAssistLoading] = useState(false)
  const [assist, setAssist] = useState<ApplicationAssistResult | null>(null)

  const refresh = useCallback(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([getAllApplications(), getAllResumes().catch(() => [] as StoredResume[])])
      .then(([apps, res]) => {
        if (cancelled) return
        setItems(apps)
        setResumes(res)
      })
      .catch((e) => {
        if (!cancelled) toast({ title: "读取失败", description: e instanceof Error ? e.message : "无法读取投递记录", variant: "destructive" })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [toast])

  useEffect(() => refresh(), [refresh])

  const resumeTitleById = useMemo(() => {
    const map = new Map<string, string>()
    resumes.forEach((r) => map.set(r.id, resumeLabel(r)))
    return map
  }, [resumes])

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase()
    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false
      if (!needle) return true
      return [item.company, item.position, item.location, item.channel, item.resumeTitle]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(needle))
    })
  }, [items, keyword, statusFilter])

  const stats = useMemo(() => {
    const total = items.length
    const active = items.filter((i) => ACTIVE_APPLICATION_STATUSES.includes(i.status)).length
    const offer = items.filter((i) => i.status === "offer").length
    const followUps = items.filter((i) => {
      const d = daysUntil(i.nextActionAt)
      return d !== null && d <= 3
    }).length
    return { total, active, offer, followUps }
  }, [items])

  const grouped = useMemo(() => {
    const map = new Map<ApplicationStatus, JobApplication[]>()
    APPLICATION_STATUS_FLOW.forEach((s) => map.set(s.value, []))
    filtered.forEach((item) => {
      const bucket = map.get(item.status)
      if (bucket) bucket.push(item)
      else map.set(item.status, [item])
    })
    return map
  }, [filtered])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm())
    setAssist(null)
    setDialogOpen(true)
  }

  const openEdit = (item: JobApplication) => {
    setEditingId(item.id)
    setAssist(null)
    setForm({
      company: item.company,
      position: item.position,
      location: item.location ?? "",
      salary: item.salary ?? "",
      channel: item.channel ?? "",
      contact: item.contact ?? "",
      jdUrl: item.jdUrl ?? "",
      jdText: item.jdText ?? "",
      resumeId: item.resumeId ?? "",
      status: item.status,
      priority: item.priority ?? "normal",
      appliedAt: toDateInput(item.appliedAt),
      nextAction: item.nextAction ?? "",
      nextActionAt: toDateInput(item.nextActionAt),
      notes: item.notes ?? "",
    })
    setDialogOpen(true)
  }

  const buildDraft = (): ApplicationDraft => ({
    company: form.company,
    position: form.position,
    location: form.location,
    salary: form.salary,
    channel: form.channel,
    contact: form.contact,
    jdUrl: form.jdUrl,
    jdText: form.jdText,
    resumeId: form.resumeId || undefined,
    resumeTitle: form.resumeId ? resumeTitleById.get(form.resumeId) : undefined,
    status: form.status,
    priority: form.priority,
    appliedAt: fromDateInput(form.appliedAt),
    nextAction: form.nextAction,
    nextActionAt: fromDateInput(form.nextActionAt),
    notes: form.notes,
  })

  const handleSave = async () => {
    if (!form.company.trim() && !form.position.trim()) {
      toast({ title: "信息不足", description: "请至少填写公司或岗位名称", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        await updateApplicationApi(editingId, buildDraft())
        toast({ title: "已更新", description: "投递信息已保存" })
      } else {
        await createApplicationApi(buildDraft())
        toast({ title: "已添加", description: "新的投递记录已创建" })
      }
      setDialogOpen(false)
      refresh()
    } catch (e) {
      toast({ title: "保存失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const advanceStatus = async (item: JobApplication) => {
    const next = getNextStatus(item.status)
    if (!next) return
    // 乐观更新
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: next } : i)))
    try {
      await updateApplicationApi(item.id, { status: next })
      toast({ title: "进度已推进", description: `${item.company || item.position} → ${getStatusMeta(next).label}` })
      refresh()
    } catch (e) {
      toast({ title: "更新失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
      refresh()
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteApplicationsApi([deleteTarget.id])
      toast({ title: "已删除", description: "投递记录已移除" })
      setDeleteTarget(null)
      refresh()
    } catch (e) {
      toast({ title: "删除失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    }
  }

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const openInsights = async () => {
    setInsightsOpen(true)
    if (insightsLoading) return
    setInsightsLoading(true)
    try {
      const report = await fetchApplicationInsights(items)
      setInsights(report)
    } catch (e) {
      toast({ title: "复盘失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    } finally {
      setInsightsLoading(false)
    }
  }

  const runAssist = async () => {
    if (!editingId) return
    const application = items.find((i) => i.id === editingId)
    if (!application) return
    setAssistLoading(true)
    try {
      let resumeData = undefined
      const resumeId = form.resumeId || application.resumeId
      if (resumeId) {
        const stored = await getResumeById(resumeId).catch(() => null)
        resumeData = stored?.resumeData
      }
      const result = await fetchApplicationAssist({ ...application, ...buildDraft(), id: application.id } as JobApplication, resumeData)
      setAssist(result)
    } catch (e) {
      toast({ title: "生成失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    } finally {
      setAssistLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部标题与导航 */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className="brand-gradient-bg grid h-9 w-9 place-items-center rounded-xl">
            <Icon icon="mdi:briefcase-check-outline" className="h-5 w-5" />
          </span>
          <h1 className="text-lg font-semibold">投递管理</h1>
          <Badge variant="secondary">{items.length} 条投递</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={() => router.push("/resumes")}>
            <Icon icon="mdi:file-account-outline" className="h-4 w-4" /> 我的简历
          </Button>
          <Button className="gap-2" onClick={openCreate}>
            <Icon icon="mdi:plus" className="h-4 w-4" /> 新增投递
          </Button>
        </div>
      </div>

      {/* 统计仪表盘 */}
      <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-4">
        {[
          { label: "总投递", value: stats.total, icon: "mdi:send-outline", tint: "text-blue-600" },
          { label: "进行中", value: stats.active, icon: "mdi:progress-clock", tint: "text-amber-600" },
          { label: "Offer", value: stats.offer, icon: "mdi:trophy-outline", tint: "text-emerald-600" },
          { label: "近 3 天待跟进", value: stats.followUps, icon: "mdi:bell-ring-outline", tint: "text-rose-600" },
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

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2">
          <Input
            placeholder="搜索公司 / 岗位 / 渠道"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="w-60"
          />
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ApplicationStatus | "all")}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="全部阶段" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部阶段</SelectItem>
              {APPLICATION_STATUS_FLOW.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="inline-flex rounded-lg border p-0.5">
          <button
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              view === "board" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            }`}
            onClick={() => setView("board")}
          >
            <Icon icon="mdi:view-column-outline" className="h-4 w-4" /> 看板
          </button>
          <button
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            }`}
            onClick={() => setView("list")}
          >
            <Icon icon="mdi:format-list-bulleted" className="h-4 w-4" /> 列表
          </button>
        </div>
      </div>

      <Separator />

      {loading ? (
        <div className="py-20 text-center text-sm text-muted-foreground">正在读取投递记录...</div>
      ) : items.length === 0 ? (
        <EmptyState onCreate={openCreate} />
      ) : view === "board" ? (
        <BoardView
          grouped={grouped}
          onAdvance={advanceStatus}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
        />
      ) : (
        <ListView
          items={filtered}
          onAdvance={advanceStatus}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
        />
      )}

      {/* 新增 / 编辑投递 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "编辑投递" : "新增投递"}</DialogTitle>
            <DialogDescription>记录目标公司、岗位与当前进度，方便统一跟踪。</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="公司" required>
                <Input value={form.company} onChange={(e) => setField("company", e.target.value)} placeholder="如：字节跳动" />
              </Field>
              <Field label="岗位" required>
                <Input value={form.position} onChange={(e) => setField("position", e.target.value)} placeholder="如：前端工程师" />
              </Field>
              <Field label="工作地点">
                <Input value={form.location} onChange={(e) => setField("location", e.target.value)} placeholder="如：上海" />
              </Field>
              <Field label="薪资">
                <Input value={form.salary} onChange={(e) => setField("salary", e.target.value)} placeholder="如：20-30K·14薪" />
              </Field>
              <Field label="投递渠道">
                <Input value={form.channel} onChange={(e) => setField("channel", e.target.value)} placeholder="如：BOSS直聘 / 内推 / 官网" />
              </Field>
              <Field label="联系人 / HR">
                <Input value={form.contact} onChange={(e) => setField("contact", e.target.value)} placeholder="如：王老师 / 微信号" />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="当前阶段">
                <Select value={form.status} onValueChange={(v) => setField("status", v as ApplicationStatus)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APPLICATION_STATUS_FLOW.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="优先级">
                <Select value={form.priority} onValueChange={(v) => setField("priority", v as ApplicationPriority)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">高</SelectItem>
                    <SelectItem value="normal">中</SelectItem>
                    <SelectItem value="low">低</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="投递日期">
                <Input type="date" value={form.appliedAt} onChange={(e) => setField("appliedAt", e.target.value)} />
              </Field>
            </div>

            <Field label="使用的简历">
              <Select
                value={form.resumeId || NONE_RESUME}
                onValueChange={(v) => setField("resumeId", v === NONE_RESUME ? "" : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择关联简历（可选）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_RESUME}>不关联简历</SelectItem>
                  {resumes.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {resumeLabel(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="下一步动作">
                <Input value={form.nextAction} onChange={(e) => setField("nextAction", e.target.value)} placeholder="如：等待笔试结果 / 准备一面" />
              </Field>
              <Field label="提醒日期">
                <Input type="date" value={form.nextActionAt} onChange={(e) => setField("nextActionAt", e.target.value)} />
              </Field>
            </div>

            <Field label="JD 链接">
              <Input value={form.jdUrl} onChange={(e) => setField("jdUrl", e.target.value)} placeholder="https://..." />
            </Field>
            <Field label="JD 要点 / 备注">
              <Textarea
                value={form.jdText}
                onChange={(e) => setField("jdText", e.target.value)}
                placeholder="粘贴 JD 关键要求，便于后续针对性优化简历"
                className="min-h-20"
              />
            </Field>
            <Field label="个人备注">
              <Textarea value={form.notes} onChange={(e) => setField("notes", e.target.value)} placeholder="面试感受、薪资谈判、待办事项…" className="min-h-16" />
            </Field>

            {editingId ? (
              <AssistPanel
                loading={assistLoading}
                result={assist}
                onRun={runAssist}
                onAdoptStep={(action) => setField("nextAction", action)}
                onCopy={(text) => {
                  navigator.clipboard?.writeText(text).then(
                    () => toast({ title: "已复制", description: "跟进文案已复制到剪贴板" }),
                    () => toast({ title: "复制失败", description: "请手动选择文本复制", variant: "destructive" }),
                  )
                }}
              />
            ) : null}

            {editingId ? <Timeline application={items.find((i) => i.id === editingId)} /> : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              <Icon icon={saving ? "mdi:loading" : "mdi:content-save-outline"} className={`h-4 w-4 ${saving ? "animate-spin" : ""}`} />
              {editingId ? "保存修改" : "创建投递"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI 投递复盘 */}
      <Dialog open={insightsOpen} onOpenChange={setInsightsOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon icon="mdi:chart-timeline-variant" className="h-5 w-5 text-primary" />
              AI 投递复盘
            </DialogTitle>
            <DialogDescription>基于你目前的全部投递数据，给出阶段分布、客观洞察与下一步策略建议。</DialogDescription>
          </DialogHeader>

          <Funnel items={items} />

          {insightsLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Icon icon="mdi:loading" className="h-4 w-4 animate-spin" /> AI 正在分析你的投递数据…
            </div>
          ) : insights ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-primary/5 p-3 text-sm">{insights.summary}</div>

              {insights.observations.length > 0 ? (
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                    <Icon icon="mdi:eye-outline" className="h-4 w-4 text-muted-foreground" /> 数据洞察
                  </div>
                  <ul className="space-y-2">
                    {insights.observations.map((item, i) => (
                      <li key={i} className="rounded-md border p-2.5 text-sm">
                        <div className="font-medium">{item.title}</div>
                        <div className="mt-0.5 text-muted-foreground">{item.detail}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {insights.recommendations.length > 0 ? (
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                    <Icon icon="mdi:lightbulb-on-outline" className="h-4 w-4 text-amber-500" /> 策略建议
                  </div>
                  <ul className="space-y-2">
                    {insights.recommendations.map((item, i) => (
                      <li key={i} className="rounded-md border p-2.5 text-sm">
                        <div className="flex items-center gap-2 font-medium">
                          {item.priority ? <PriorityDot priority={item.priority} /> : null}
                          {item.title}
                        </div>
                        <div className="mt-0.5 text-muted-foreground">{item.detail}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="text-right">
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={openInsights}>
                  <Icon icon="mdi:refresh" className="h-3.5 w-3.5" /> 重新分析
                </Button>
              </div>
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-muted-foreground">点击下方按钮，让 AI 复盘你的投递情况。</div>
          )}

          {!insightsLoading && !insights ? (
            <DialogFooter>
              <Button onClick={openInsights} className="gap-2">
                <Icon icon="mdi:robot-happy-outline" className="h-4 w-4" /> 开始 AI 复盘
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这条投递？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{deleteTarget?.company} · {deleteTarget?.position}」，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 右下角 AI 复盘悬浮气泡 */}
      {items.length > 0 ? (
        <button
          onClick={openInsights}
          title="AI 投递复盘"
          className="brand-gradient-bg fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-sm font-medium shadow-lg shadow-primary/25 transition-transform hover:-translate-y-0.5 hover:shadow-xl"
        >
          <Icon icon="mdi:chart-timeline-variant" className="h-5 w-5" />
          AI 复盘
        </button>
      ) : null}
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? <span className="ml-0.5 text-rose-500">*</span> : null}
      </span>
      {children}
    </label>
  )
}

function StatusBadge({ status }: { status: ApplicationStatus }) {
  const meta = getStatusMeta(status)
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${meta.accent}`}>
      <Icon icon={meta.icon} className="h-3 w-3" />
      {meta.label}
    </span>
  )
}

function NextActionHint({ application }: { application: JobApplication }) {
  if (!application.nextAction && !application.nextActionAt) return null
  const days = daysUntil(application.nextActionAt)
  const overdue = days !== null && days < 0
  const soon = days !== null && days >= 0 && days <= 3
  return (
    <div
      className={`mt-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${
        overdue ? "bg-rose-50 text-rose-600" : soon ? "bg-amber-50 text-amber-700" : "bg-muted text-muted-foreground"
      }`}
    >
      <Icon icon="mdi:bell-outline" className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">
        {application.nextAction || "待跟进"}
        {application.nextActionAt
          ? ` · ${overdue ? `已逾期 ${Math.abs(days!)} 天` : days === 0 ? "今天" : `${days} 天后`}`
          : ""}
      </span>
    </div>
  )
}

function ApplicationCard({
  application,
  onAdvance,
  onEdit,
  onDelete,
}: {
  application: JobApplication
  onAdvance: (item: JobApplication) => void
  onEdit: (item: JobApplication) => void
  onDelete: (item: JobApplication) => void
}) {
  const next = getNextStatus(application.status)
  const priority = application.priority ?? "normal"
  return (
    <div className="group rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <button className="min-w-0 text-left" onClick={() => onEdit(application)}>
          <div className="truncate text-sm font-semibold">{application.company || "未命名公司"}</div>
          <div className="truncate text-xs text-muted-foreground">{application.position || "未填写岗位"}</div>
        </button>
        {priority === "high" ? (
          <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${PRIORITY_META.high.className}`}>高优</span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {application.location ? (
          <span className="inline-flex items-center gap-0.5">
            <Icon icon="mdi:map-marker-outline" className="h-3 w-3" />
            {application.location}
          </span>
        ) : null}
        {application.channel ? (
          <span className="inline-flex items-center gap-0.5">
            <Icon icon="mdi:source-branch" className="h-3 w-3" />
            {application.channel}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-0.5">
          <Icon icon="mdi:calendar-outline" className="h-3 w-3" />
          {formatDate(application.appliedAt || application.createdAt)}
        </span>
      </div>

      {application.resumeTitle ? (
        <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          <Icon icon="mdi:file-account-outline" className="h-3 w-3 shrink-0" />
          <span className="truncate">{application.resumeTitle}</span>
        </div>
      ) : null}

      <NextActionHint application={application} />

      <div className="mt-3 flex items-center justify-between gap-2">
        {next ? (
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => onAdvance(application)}>
            <Icon icon="mdi:arrow-right-bold" className="h-3.5 w-3.5" />
            推进到 {getStatusMeta(next).label}
          </Button>
        ) : (
          <span className="text-[11px] text-muted-foreground">已是终态</span>
        )}
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(application)} title="编辑">
            <Icon icon="mdi:pencil-outline" className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-destructive" onClick={() => onDelete(application)} title="删除">
            <Icon icon="mdi:trash-can-outline" className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function BoardView({
  grouped,
  onAdvance,
  onEdit,
  onDelete,
}: {
  grouped: Map<ApplicationStatus, JobApplication[]>
  onAdvance: (item: JobApplication) => void
  onEdit: (item: JobApplication) => void
  onDelete: (item: JobApplication) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // 鼠标按住拖动平移看板；记录起点与是否真正发生了拖动
  const drag = useRef({ active: false, moved: false, startX: 0, startScroll: 0 })

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 仅鼠标左键启用拖动；触屏/触控板有原生横向滑动，无需接管
    if (e.pointerType !== "mouse" || e.button !== 0) return
    const el = scrollRef.current
    if (!el) return
    drag.current = { active: true, moved: false, startX: e.clientX, startScroll: el.scrollLeft }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!el || !drag.current.active) return
    const dx = e.clientX - drag.current.startX
    if (!drag.current.moved && Math.abs(dx) < 6) return
    if (!drag.current.moved) {
      drag.current.moved = true
      el.setPointerCapture(e.pointerId)
      el.classList.add("cursor-grabbing")
    }
    el.scrollLeft = drag.current.startScroll - dx
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (el) {
      el.classList.remove("cursor-grabbing")
      if (el.hasPointerCapture?.(e.pointerId)) {
        try {
          el.releasePointerCapture(e.pointerId)
        } catch {
          /* ignore */
        }
      }
    }
    drag.current.active = false
  }

  // 若刚刚发生过拖动，吞掉随之而来的 click，避免误开卡片
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (drag.current.moved) {
      e.preventDefault()
      e.stopPropagation()
      drag.current.moved = false
    }
  }

  return (
    <div
      ref={scrollRef}
      className="flex cursor-grab select-none gap-3 overflow-x-auto p-4 [scrollbar-width:thin]"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={onClickCapture}
    >
      {APPLICATION_STATUS_FLOW.map((s) => {
        const list = grouped.get(s.value) ?? []
        return (
          <div key={s.value} className="flex min-h-[60vh] w-72 min-w-72 shrink-0 flex-col rounded-xl bg-muted/40">
            <div className="flex items-center justify-between gap-2 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
                <span className="text-sm font-medium">{s.label}</span>
              </div>
              <Badge variant="secondary">{list.length}</Badge>
            </div>
            <div className="flex flex-1 flex-col gap-2 px-2 pb-3">
              {list.length === 0 ? (
                <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">暂无</div>
              ) : (
                list.map((item) => (
                  <ApplicationCard
                    key={item.id}
                    application={item}
                    onAdvance={onAdvance}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ListView({
  items,
  onAdvance,
  onEdit,
  onDelete,
}: {
  items: JobApplication[]
  onAdvance: (item: JobApplication) => void
  onEdit: (item: JobApplication) => void
  onDelete: (item: JobApplication) => void
}) {
  if (items.length === 0) {
    return <div className="py-16 text-center text-sm text-muted-foreground">没有匹配的投递记录</div>
  }
  return (
    <div className="divide-y">
      {items.map((item) => {
        const next = getNextStatus(item.status)
        return (
          <div key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/30">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <button className="truncate font-medium" onClick={() => onEdit(item)}>
                  {item.company || "未命名公司"}
                </button>
                <StatusBadge status={item.status} />
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className="truncate">{item.position || "未填写岗位"}</span>
                {item.location ? <span>{item.location}</span> : null}
                {item.channel ? <span>{item.channel}</span> : null}
                <span>投递 {formatDate(item.appliedAt || item.createdAt)}</span>
                {item.resumeTitle ? (
                  <span className="inline-flex items-center gap-1">
                    <Icon icon="mdi:file-account-outline" className="h-3 w-3" />
                    {item.resumeTitle}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {next ? (
                <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => onAdvance(item)}>
                  <Icon icon="mdi:arrow-right-bold" className="h-3.5 w-3.5" />
                  {getStatusMeta(next).label}
                </Button>
              ) : null}
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onEdit(item)}>
                <Icon icon="mdi:pencil-outline" className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive" onClick={() => onDelete(item)}>
                <Icon icon="mdi:trash-can-outline" className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Timeline({ application }: { application?: JobApplication }) {
  if (!application || application.events.length === 0) return null
  const events = [...application.events].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon icon="mdi:timeline-clock-outline" className="h-4 w-4" />
        进度时间线
      </div>
      <ol className="space-y-2">
        {events.map((event) => (
          <li key={event.id} className="flex items-start gap-2 text-xs">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0">
              <div className="font-medium">{event.title}</div>
              <div className="text-muted-foreground">
                {formatDate(event.date)}
                {event.note ? ` · ${event.note}` : ""}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function PriorityDot({ priority }: { priority: "high" | "medium" | "low" }) {
  const color = priority === "high" ? "bg-rose-500" : priority === "medium" ? "bg-amber-500" : "bg-slate-400"
  const label = priority === "high" ? "高" : priority === "medium" ? "中" : "低"
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  )
}

function Funnel({ items }: { items: JobApplication[] }) {
  const counts = APPLICATION_STATUS_FLOW.map((s) => ({
    meta: s,
    count: items.filter((i) => i.status === s.value).length,
  }))
  const max = Math.max(1, ...counts.map((c) => c.count))
  return (
    <div className="space-y-1.5 rounded-lg border p-3">
      {counts.map(({ meta, count }) => (
        <div key={meta.value} className="flex items-center gap-2 text-xs">
          <span className="w-16 shrink-0 text-muted-foreground">{meta.label}</span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
            <div className={`h-full ${meta.dot}`} style={{ width: `${(count / max) * 100}%` }} />
          </div>
          <span className="w-6 shrink-0 text-right tabular-nums">{count}</span>
        </div>
      ))}
    </div>
  )
}

function AssistPanel({
  loading,
  result,
  onRun,
  onAdoptStep,
  onCopy,
}: {
  loading: boolean
  result: ApplicationAssistResult | null
  onRun: () => void
  onAdoptStep: (action: string) => void
  onCopy: (text: string) => void
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon icon="mdi:robot-happy-outline" className="h-4 w-4 text-primary" />
          AI 阶段助手
        </div>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onRun} disabled={loading}>
          <Icon icon={loading ? "mdi:loading" : "mdi:auto-fix"} className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {result ? "重新生成" : "给我建议"}
        </Button>
      </div>

      {loading ? (
        <div className="py-4 text-center text-xs text-muted-foreground">AI 正在结合当前阶段与简历给出建议…</div>
      ) : result ? (
        <div className="mt-3 space-y-3 text-sm">
          <div className="text-muted-foreground">{result.summary}</div>

          {result.nextSteps.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">建议的下一步</div>
              {result.nextSteps.map((step, i) => (
                <div key={i} className="flex items-start justify-between gap-2 rounded-md border bg-background p-2">
                  <div className="min-w-0">
                    <div className="font-medium">{step.action}</div>
                    {step.reason ? <div className="mt-0.5 text-xs text-muted-foreground">{step.reason}</div> : null}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 gap-1 px-2 text-xs"
                    onClick={() => onAdoptStep(step.action)}
                    title="填入“下一步动作”"
                  >
                    <Icon icon="mdi:check" className="h-3.5 w-3.5" /> 采纳
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          {result.followUpMessage ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">可复制的跟进消息</span>
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => onCopy(result.followUpMessage)}>
                  <Icon icon="mdi:content-copy" className="h-3.5 w-3.5" /> 复制
                </Button>
              </div>
              <div className="whitespace-pre-wrap rounded-md border bg-background p-2 text-xs leading-relaxed">{result.followUpMessage}</div>
            </div>
          ) : null}

          {result.interviewTopics.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">可能被深挖的面试主题</div>
              <div className="flex flex-wrap gap-1.5">
                {result.interviewTopics.map((topic, i) => (
                  <span key={i} className="rounded-full border bg-background px-2 py-0.5 text-xs">{topic}</span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="py-3 text-center text-xs text-muted-foreground">
          根据「当前阶段 + 关联简历 + JD」生成下一步行动、跟进文案与面试准备。
        </div>
      )}
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="py-16">
      <div className="mx-auto max-w-xl rounded-xl border bg-muted/30 p-10 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <Icon icon="mdi:briefcase-plus-outline" className="h-8 w-8 text-primary" />
        </div>
        <h3 className="text-xl font-semibold">还没有投递记录</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          把每一次投递都记录下来：投了哪家、用了哪份简历、进展到哪一步，集中跟踪不漏接。
        </p>
        <Button onClick={onCreate} className="mt-6 gap-2">
          <Icon icon="mdi:plus" className="h-4 w-4" /> 新增第一条投递
        </Button>
      </div>
    </div>
  )
}
