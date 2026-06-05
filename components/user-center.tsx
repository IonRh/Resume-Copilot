"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
// Avoid Radix Avatar/Checkbox to prevent extra deps; use basic elements
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Icon } from "@iconify/react"
import { useToast } from "@/hooks/use-toast"
import type { StoredResume } from "@/types/resume"
import { importFromMagicyanFile } from "@/lib/utils"
import { StorageError, createEntryFromData, deleteResumes, getAllResumes, loadDefaultTemplate, loadExampleTemplate } from "@/lib/storage"
import { createDefaultResumeData } from "@/lib/utils"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import ExportButton from "@/components/export-button"

type SortKey = "name" | "createdAt" | "updatedAt"
type SortDir = "asc" | "desc"

export default function UserCenter() {
  const router = useRouter()
  const { toast } = useToast()

  const [items, setItems] = useState<StoredResume[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [keyword, setKeyword] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [importing, setImporting] = useState(false)

  const refresh = useCallback(() => {
    try {
      setItems(getAllResumes())
    } catch (e) {
      toast({ title: "读取失败", description: e instanceof Error ? e.message : "无法读取本地存储" })
    }
  }, [toast])

  useEffect(() => {
    refresh()
  }, [refresh])

  // 轻量预取新建/示例模板，提升后续进入编辑页的首屏速度
  useEffect(() => {
    // 忽略结果，仅触发浏览器缓存
    loadDefaultTemplate()
    loadExampleTemplate()
  }, [])

  const filteredSorted = useMemo(() => {
    const list = items.filter((it) =>
      !keyword.trim() || it.resumeData.title.toLowerCase().includes(keyword.trim().toLowerCase())
    )
    const sorted = [...list].sort((a, b) => {
      let va: string | number = ""
      let vb: string | number = ""
      if (sortKey === "name") {
        va = a.resumeData.title || ""
        vb = b.resumeData.title || ""
        return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
      }
      if (sortKey === "createdAt") {
        va = new Date(a.createdAt).getTime()
        vb = new Date(b.createdAt).getTime()
      } else {
        va = new Date(a.updatedAt).getTime()
        vb = new Date(b.updatedAt).getTime()
      }
      return sortDir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number)
    })
    return sorted
  }, [items, keyword, sortKey, sortDir])

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
    if (checked) setSelected(new Set(items.map((i) => i.id)))
    else setSelected(new Set())
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
    void prefetchAndOpenNew("default")
  }

  const handleClone = (id: string) => {
    // 不立即保存，带上 cloneId 进入新建编辑页
    router.push(`/edit/new?clone=${encodeURIComponent(id)}`)
  }

  // 最近更新的一份简历，作为求职工具的默认操作对象
  const mostRecent = useMemo(
    () =>
      [...items].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )[0],
    [items],
  )

  // 求职工具入口：把待办指令写入 sessionStorage，进入工作区后自动呼出 AI 并发起任务
  const openTool = useCallback(
    (prompt: string) => {
      if (!mostRecent) {
        toast({ title: "还没有简历", description: "请先创建或导入一份简历，再使用求职工具。" })
        return
      }
      try {
        sessionStorage.setItem("agent-kickoff", JSON.stringify({ prompt }))
      } catch {
        /* sessionStorage 不可用时仍正常进入编辑页 */
      }
      router.push(`/edit/${mostRecent.id}`)
    },
    [mostRecent, router, toast],
  )

  const handleImport: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      if (!file.name.endsWith(".json")) {
        toast({ title: "文件格式错误", description: "请选择 .json 格式的文件", variant: "destructive" })
        return
      }
      if (file.size > 5 * 1024 * 1024) {
        toast({ title: "文件过大", description: "文件大小不能超过 5MB", variant: "destructive" })
        return
      }
      setImporting(true)
      const content = await file.text()
      const data = importFromMagicyanFile(content)
      const entry = createEntryFromData(data)
      toast({ title: "导入成功", description: `已导入：${entry.resumeData.title}` })
      refresh()
      // Do not auto-navigate; user can choose next action
    } catch (e: unknown) {
      if (e instanceof StorageError && e.code === "QUOTA_EXCEEDED") {
        toast({ title: "存储空间不足", description: "请删除旧简历或先导出为 JSON 后再清理。", variant: "destructive" })
      } else {
        const message = e instanceof Error ? e.message : "文件解析或保存失败"
        toast({ title: "导入失败", description: message, variant: "destructive" })
      }
    } finally {
      setImporting(false)
      event.target.value = ""
    }
  }

  const handleDelete = (ids: string[]) => {
    try {
      deleteResumes(ids)
      toast({ title: "删除成功", description: `已删除 ${ids.length} 条简历` })
      setSelected(new Set())
      refresh()
    } catch (e) {
      toast({ title: "删除失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* 统一隐藏文件输入，空态也可使用 */}
      <input id="uc-import-file" type="file" accept=".json" className="hidden" onChange={handleImport} />

      {/* AI + 求职 品牌横幅 */}
      <div className="p-4 pb-0">
        <div className="ai-hero px-6 py-8 sm:px-10 sm:py-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
                <Icon icon="mdi:sparkles" className="h-3.5 w-3.5 text-primary" />
                AI Native · 大学生求职全流程
              </div>
              <h1 className="mt-4 text-3xl font-bold leading-tight sm:text-4xl">
                <span className="brand-gradient-text">AI + 求职</span>
                <span className="text-foreground"> 简历工作区</span>
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
                左侧手工编辑、中间实时预览，右上角呼出 AI Agent 即进入三分屏工作区。
                Agent 可润色改写、调整结构与样式、对照 JD 优化、给出评分诊断与模拟面试，所有改动均以 diff 卡片确认后落地。
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button onClick={handleCreate} className="brand-gradient-bg gap-2 border-0">
                  <Icon icon="mdi:robot-happy-outline" className="h-4 w-4" /> AI 智能创建
                </Button>
                <Button
                  variant="outline"
                  className="gap-2 bg-transparent"
                  onClick={() => prefetchAndOpenNew("example")}
                >
                  <Icon icon="mdi:lightbulb-on-outline" className="h-4 w-4" /> 从示例开始
                </Button>
              </div>
              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                {[
                  { icon: "mdi:auto-fix", label: "逐句润色改写" },
                  { icon: "mdi:file-tree", label: "结构智能重排" },
                  { icon: "mdi:target", label: "JD 精准匹配" },
                  { icon: "mdi:chart-box-outline", label: "简历评分诊断" },
                  { icon: "mdi:account-voice", label: "模拟面试" },
                ].map((f) => (
                  <span key={f.label} className="inline-flex items-center gap-1.5">
                    <Icon icon={f.icon} className="h-3.5 w-3.5 text-primary" />
                    {f.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="hidden shrink-0 sm:block">
              <div className="brand-gradient-bg grid h-28 w-28 place-items-center rounded-3xl shadow-lg shadow-primary/20">
                <Icon icon="mdi:file-account-outline" className="h-14 w-14" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AI 求职工具路口 */}
      <div className="p-4 pb-0">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            {
              icon: "mdi:auto-fix",
              title: "AI 简历润色",
              desc: "通读最近简历，逐句润色并量化成果",
              prompt:
                "请通读我的简历，先给出整体优化建议，再针对每段经历逐句润色，突出量化成果与影响，所有改动用 diff 形式给我确认。",
            },
            {
              icon: "mdi:target",
              title: "JD 匹配优化",
              desc: "对照目标岗位 JD 分析匹配度并优化",
              prompt:
                "我要做岗位匹配优化。请让我把目标岗位 JD 发给你，然后分析我的简历与该岗位的匹配度，列出已命中 / 缺失关键词，并给出可直接落地的修改建议。",
            },
            {
              icon: "mdi:account-voice",
              title: "模拟面试",
              desc: "基于简历出题，逐题点评并追问",
              prompt:
                "请基于我的简历进行模拟面试：先提出 5 道有针对性的问题（标注考察点与作答提示），我会逐题作答，请逐一点评并适当追问。",
            },
          ].map((tool) => (
            <button
              key={tool.title}
              onClick={() => openTool(tool.prompt)}
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
          <Badge variant="secondary">{items.length}</Badge>
        </div>
        {items.length > 0 && (
          <div className="flex items-center gap-2">
            <Input
              placeholder="搜索简历名称"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-56"
            />
            {null}
            <Separator orientation="vertical" className="h-6" />
            <Button
              variant="default"
              className="gap-2"
              onClick={() => document.getElementById("uc-import-file")?.click()}
              disabled={importing}
            >
              <Icon icon="mdi:import" className="w-4 h-4" /> 导入
            </Button>
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
          </div>
        )}
      </div>

      <Separator />

      {/* 列表（表格） */}
      <div className="p-4 space-y-3">
        {items.length > 0 && (
          <div className="flex items-center gap-3 px-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border"
              checked={selected.size > 0 && selected.size === items.length}
              onChange={(e) => toggleSelectAll(e.target.checked)}
            />
            <span className="text-sm text-muted-foreground">已选 {selected.size} 项</span>
          </div>
        )}
        {filteredSorted.length === 0 ? (
          <div className="py-16">
            <div className="mx-auto max-w-xl text-center rounded-xl border bg-muted/30 p-10 shadow-sm">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <Icon icon="mdi:file-document-edit" className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold">暂无简历</h3>
              <div className="mt-2 inline-flex flex-col items-stretch">
                <p className="text-sm text-muted-foreground">点击“创建简历”开始，或从 JSON 文件导入已有数据并继续编辑</p>
                <div className="mt-6 flex items-center justify-between">
                  <Button onClick={handleCreate} className="gap-2 shrink-0">
                    <Icon icon="mdi:plus" className="w-4 h-4" /> 创建简历
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2 shrink-0"
                    onClick={() => document.getElementById("uc-import-file")?.click()}
                    disabled={importing}
                  >
                    <Icon icon="mdi:import" className="w-4 h-4" /> 导入
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2 shrink-0"
                    onClick={() => prefetchAndOpenNew("example")}
                  >
                    <Icon icon="mdi:lightbulb-on" className="w-4 h-4" /> 示例
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2 shrink-0"
                    onClick={() => window.open("https://github.com/wzdnzd/resume", "_blank", "noopener,noreferrer")}
                  >
                    <Icon icon="mdi:github" className="w-4 h-4" /> GitHub
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
                <TableHead className="text-center">编号</TableHead>
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
                <TableHead className="text-center w-[360px]">
                  <div className="flex items-center justify-center">操作</div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSorted.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border"
                      checked={selected.has(it.id)}
                      onChange={(e) => toggleSelect(it.id, e.target.checked)}
                    />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground text-center">{it.id.slice(0, 8)}</TableCell>
                  <TableCell className="text-center">
                    <div className="h-10 w-10 rounded-full overflow-hidden bg-muted flex items-center justify-center mx-auto">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={it.resumeData.avatar || "/not-set.png"}
                        alt={it.resumeData.title}
                        className="h-full w-full object-cover"
                        onError={(ev) => { (ev.currentTarget as HTMLImageElement).src = "/default-avatar.jpg" }}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{it.resumeData.title || "未命名"}</TableCell>
                  <TableCell className="text-xs text-center">{new Date(it.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="text-xs text-center">{new Date(it.updatedAt).toLocaleString()}</TableCell>
                  <TableCell className="text-right w-[360px]">
                    <div className="flex items-center gap-2 justify-end">
                      <Button variant="ghost" className="gap-2" onClick={() => router.push(`/view/${it.id}`)}>
                        <Icon icon="mdi:eye" className="w-4 h-4" /> 查看
                      </Button>
                      <ExportButton
                        resumeData={it.resumeData}
                        variant="ghost"
                      />
                      <Button variant="ghost" className="gap-2" onClick={() => router.push(`/edit/${it.id}`)}>
                        <Icon icon="mdi:pencil" className="w-4 h-4" /> 编辑
                      </Button>
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
            </TableBody>
          </Table>
        )}
      </div>

      {/* 删除确认 */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除所选简历？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可撤销，建议先导出重要的简历数据为 JSON 文件保存。
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
    </div>
  )
}
