import type {
  ResumeData,
  ResumeModule,
  ModuleContentRow,
  ModuleContentElement,
  PersonalInfoItem,
  JobIntentionItem,
} from "@/types/resume"
import type { AgentCard, ChangeSet, ToolResult } from "./types"
import {
  buildResumeOutline,
  docToText,
  findElement,
  findModule,
  findRow,
  genId,
  getDocTextAlign,
  reindexOrder,
  textToDoc,
  withUpdatedElement,
  withUpdatedModule,
} from "./changeset"
import { READONLY_TOOLS } from "./tool-schemas"

type Args = Record<string, unknown>

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback)
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined)
const int = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined

interface RowSpec {
  type?: "rich" | "tags"
  columns?: number
  texts?: string[]
  tags?: string[]
}

function buildRow(spec: RowSpec, order: number): ModuleContentRow {
  if (spec.type === "tags") {
    return {
      id: genId("row"),
      type: "tags",
      columns: 1,
      elements: [],
      tags: Array.isArray(spec.tags) ? spec.tags.map(String) : [],
      order,
    }
  }
  const texts = Array.isArray(spec.texts) ? spec.texts.map(String) : []
  const columns = Math.min(4, Math.max(1, spec.columns || texts.length || 1)) as 1 | 2 | 3 | 4
  const elements: ModuleContentElement[] = []
  for (let i = 0; i < columns; i++) {
    // 三列经验/教育行的常见对齐：左/中/右
    const align = columns === 3 ? ["left", "center", "right"][i] : "left"
    elements.push({
      id: genId("el"),
      content: textToDoc(texts[i] ?? "", align),
      columnIndex: i,
    })
  }
  return { id: genId("row"), type: "rich", columns, elements, order }
}

function buildModule(title: string, rows: RowSpec[] | undefined, order: number): ResumeModule {
  return {
    id: genId("mod"),
    title: title || "新模块",
    icon: '<path fill="currentColor" d="M3 3h18v2H3zm0 4h18v2H3zm0 4h12v2H3zm0 4h18v2H3zm0 4h12v2H3z"/>',
    order,
    rows: (rows || []).map((r, i) => buildRow(r, i)),
  }
}

function buildPersonalItems(raw: unknown): PersonalInfoItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map((it, idx) => {
    const o = (it || {}) as Args
    const type = str(o.type) === "link" ? "link" : "text"
    return {
      id: genId("info"),
      label: str(o.label),
      value: {
        content: str(o.content),
        type,
        ...(type === "link" && o.linkTitle ? { title: str(o.linkTitle) } : {}),
      },
      icon: "mdi:information",
      order: idx,
    }
  })
}

function buildJobItems(raw: unknown): JobIntentionItem[] {
  if (!Array.isArray(raw)) return []
  const allowed = ["workYears", "position", "city", "salary", "custom"]
  return raw.map((it, idx) => {
    const o = (it || {}) as Args
    const type = (allowed.includes(str(o.type)) ? str(o.type) : "custom") as JobIntentionItem["type"]
    return {
      id: genId("jii"),
      label: str(o.label),
      value: str(o.value),
      order: idx,
      type,
    }
  })
}

/** 将完整草稿转换为 ResumeData（保留时间戳由调用方处理） */
function draftToResumeData(draft: Args, base: ResumeData): ResumeData {
  const personalInfo = buildPersonalItems(draft.personalInfo)
  const ji = (draft.jobIntention || {}) as Args
  const now = new Date().toISOString()
  return {
    title: str(draft.title, "我的简历"),
    centerTitle: bool(draft.centerTitle) ?? true,
    themeColor: str(draft.themeColor) || base.themeColor,
    personalInfoSection: {
      personalInfo,
      showPersonalInfoLabels: base.personalInfoSection?.showPersonalInfoLabels ?? false,
      avatarShape: base.personalInfoSection?.avatarShape ?? "circle",
      avatarType: base.personalInfoSection?.avatarType ?? "default",
      layout: base.personalInfoSection?.layout ?? { mode: "grid", itemsPerRow: 2 },
    },
    jobIntentionSection: {
      enabled: bool(ji.enabled) ?? true,
      items: buildJobItems(ji.items),
    },
    modules: (Array.isArray(draft.modules) ? draft.modules : []).map((m, i) => {
      const mo = (m || {}) as Args
      return buildModule(str(mo.title), mo.rows as RowSpec[] | undefined, i)
    }),
    avatar: base.avatar,
    createdAt: base.createdAt || now,
    updatedAt: now,
  }
}

/** 执行单个工具，产出回传模型的文本结果，以及可选的变更/卡片 */
export function executeTool(name: string, args: Args, data: ResumeData): ToolResult {
  switch (name) {
    /* ---------- 只读 ---------- */
    case "get_resume": {
      return { ok: true, message: buildResumeOutline(data) }
    }

    /* ---------- 文本 ---------- */
    case "update_element_text": {
      const elementId = str(args.elementId)
      const loc = findElement(data, elementId)
      if (!loc) return { ok: false, message: `未找到元素 ${elementId}` }
      const before = docToText(loc.element.content)
      const after = str(args.text)
      const align = getDocTextAlign(loc.element.content)
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "text",
        op: name,
        summary: str(args.summary) || `改写「${loc.module.title}」中的文本`,
        targetIds: [elementId],
        before,
        after,
        apply: (d) =>
          withUpdatedElement(d, elementId, (el) => ({ ...el, content: textToDoc(after, align) })),
      }
      return { ok: true, message: `已暂存对元素 ${elementId} 的改写，等待用户确认。`, change }
    }

    /* ---------- 标题 ---------- */
    case "update_title": {
      const title = args.title !== undefined ? str(args.title) : undefined
      const centerTitle = bool(args.centerTitle)
      if (title === undefined && centerTitle === undefined)
        return { ok: false, message: "未提供任何标题修改" }
      const parts: string[] = []
      if (title !== undefined) parts.push(`标题→"${title}"`)
      if (centerTitle !== undefined) parts.push(centerTitle ? "居中" : "左对齐")
      const change: ChangeSet = {
        id: genId("chg"),
        kind: title !== undefined ? "text" : "style",
        op: name,
        summary: `更新简历标题（${parts.join("，")}）`,
        targetIds: ["title"],
        before: data.title,
        after: title,
        note: centerTitle !== undefined ? (centerTitle ? "居中显示" : "左对齐") : undefined,
        apply: (d) => ({
          ...d,
          title: title !== undefined ? title : d.title,
          centerTitle: centerTitle !== undefined ? centerTitle : d.centerTitle,
        }),
      }
      return { ok: true, message: "已暂存标题修改。", change }
    }

    /* ---------- 模块 ---------- */
    case "update_module": {
      const moduleId = str(args.moduleId)
      const module = findModule(data, moduleId)
      if (!module) return { ok: false, message: `未找到模块 ${moduleId}` }
      const title = args.title !== undefined ? str(args.title) : undefined
      if (title === undefined) return { ok: false, message: "未提供新的模块标题" }
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "text",
        op: name,
        summary: `模块标题「${module.title}」→「${title}」`,
        targetIds: [moduleId],
        before: module.title,
        after: title,
        apply: (d) => withUpdatedModule(d, moduleId, (m) => ({ ...m, title })),
      }
      return { ok: true, message: "已暂存模块标题修改。", change }
    }

    case "add_module": {
      const title = str(args.title, "新模块")
      const afterModuleId = str(args.afterModuleId)
      const rows = args.rows as RowSpec[] | undefined
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "structure",
        op: name,
        summary: `新增模块「${title}」`,
        targetIds: [],
        note: `${(rows || []).length} 行`,
        apply: (d) => {
          const newModule = buildModule(title, rows, d.modules.length)
          const list = [...d.modules]
          const idx = afterModuleId ? list.findIndex((m) => m.id === afterModuleId) : -1
          if (idx >= 0) list.splice(idx + 1, 0, newModule)
          else list.push(newModule)
          return { ...d, modules: reindexOrder(list) }
        },
      }
      return { ok: true, message: `已暂存新增模块「${title}」。`, change }
    }

    case "remove_module": {
      const moduleId = str(args.moduleId)
      const module = findModule(data, moduleId)
      if (!module) return { ok: false, message: `未找到模块 ${moduleId}` }
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "structure",
        op: name,
        summary: `删除模块「${module.title}」`,
        targetIds: [],
        note: "该模块及其全部内容将被移除",
        apply: (d) => ({ ...d, modules: reindexOrder(d.modules.filter((m) => m.id !== moduleId)) }),
      }
      return { ok: true, message: `已暂存删除模块「${module.title}」。`, change }
    }

    case "reorder_modules": {
      const ordered = Array.isArray(args.orderedModuleIds) ? args.orderedModuleIds.map(String) : []
      if (ordered.length === 0) return { ok: false, message: "未提供模块顺序" }
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "structure",
        op: name,
        summary: "重排模块顺序",
        targetIds: [],
        apply: (d) => {
          const byId = new Map(d.modules.map((m) => [m.id, m]))
          const result: ResumeModule[] = []
          ordered.forEach((id) => {
            const m = byId.get(id)
            if (m) {
              result.push(m)
              byId.delete(id)
            }
          })
          d.modules.forEach((m) => {
            if (byId.has(m.id)) result.push(m)
          })
          return { ...d, modules: reindexOrder(result) }
        },
      }
      return { ok: true, message: "已暂存模块重排。", change }
    }

    /* ---------- 行 ---------- */
    case "add_row": {
      const moduleId = str(args.moduleId)
      const module = findModule(data, moduleId)
      if (!module) return { ok: false, message: `未找到模块 ${moduleId}` }
      const afterRowId = str(args.afterRowId)
      const spec: RowSpec = {
        type: str(args.type) === "tags" ? "tags" : "rich",
        columns: int(args.columns),
        texts: Array.isArray(args.texts) ? args.texts.map(String) : undefined,
        tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
      }
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "structure",
        op: name,
        summary: `在「${module.title}」新增一行`,
        targetIds: [moduleId],
        apply: (d) =>
          withUpdatedModule(d, moduleId, (m) => {
            const rows = [...m.rows]
            const idx = afterRowId ? rows.findIndex((r) => r.id === afterRowId) : -1
            const insertAt = idx >= 0 ? idx + 1 : rows.length
            rows.splice(insertAt, 0, buildRow(spec, insertAt))
            return { ...m, rows: reindexOrder(rows) }
          }),
      }
      return { ok: true, message: "已暂存新增行。", change }
    }

    case "remove_row": {
      const moduleId = str(args.moduleId)
      const rowId = str(args.rowId)
      const module = findModule(data, moduleId)
      if (!module) return { ok: false, message: `未找到模块 ${moduleId}` }
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "structure",
        op: name,
        summary: `删除「${module.title}」中的一行`,
        targetIds: [moduleId],
        apply: (d) =>
          withUpdatedModule(d, moduleId, (m) => ({
            ...m,
            rows: reindexOrder(m.rows.filter((r) => r.id !== rowId)),
          })),
      }
      return { ok: true, message: "已暂存删除行。", change }
    }

    case "set_row_tags": {
      const rowId = str(args.rowId)
      const found = findRow(data, rowId)
      if (!found) return { ok: false, message: `未找到行 ${rowId}` }
      const tags = Array.isArray(args.tags) ? args.tags.map(String) : []
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "text",
        op: name,
        summary: `更新「${found.module.title}」标签`,
        targetIds: [found.module.id],
        before: (found.row.tags || []).join("、"),
        after: tags.join("、"),
        apply: (d) =>
          withUpdatedModule(d, found.module.id, (m) => ({
            ...m,
            rows: m.rows.map((r) => (r.id === rowId ? { ...r, type: "tags", tags } : r)),
          })),
      }
      return { ok: true, message: "已暂存标签修改。", change }
    }

    /* ---------- 个人信息 ---------- */
    case "set_personal_info": {
      const items = buildPersonalItems(args.items)
      const showLabels = bool(args.showLabels)
      const layoutMode = str(args.layoutMode) === "inline" ? "inline" : str(args.layoutMode) === "grid" ? "grid" : undefined
      const itemsPerRow = int(args.itemsPerRow)
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "structure",
        op: name,
        summary: "更新个人信息",
        targetIds: ["personal"],
        before: data.personalInfoSection.personalInfo.map((i) => `${i.label}:${i.value.content}`).join("，"),
        after: items.map((i) => `${i.label}:${i.value.content}`).join("，"),
        apply: (d) => ({
          ...d,
          personalInfoSection: {
            ...d.personalInfoSection,
            personalInfo: items,
            showPersonalInfoLabels:
              showLabels !== undefined ? showLabels : d.personalInfoSection.showPersonalInfoLabels,
            layout: {
              mode: layoutMode ?? d.personalInfoSection.layout?.mode ?? "grid",
              itemsPerRow: (itemsPerRow ?? d.personalInfoSection.layout?.itemsPerRow ?? 2) as 1 | 2 | 3 | 4 | 5 | 6,
            },
          },
        }),
      }
      return { ok: true, message: "已暂存个人信息修改。", change }
    }

    /* ---------- 求职意向 ---------- */
    case "set_job_intention": {
      const items = buildJobItems(args.items)
      const enabled = bool(args.enabled) ?? true
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "structure",
        op: name,
        summary: "更新求职意向",
        targetIds: ["jobIntention"],
        before: (data.jobIntentionSection?.items || []).map((i) => `${i.label}:${i.value}`).join("，"),
        after: items.map((i) => `${i.label}:${i.value}`).join("，"),
        apply: (d) => ({ ...d, jobIntentionSection: { enabled, items } }),
      }
      return { ok: true, message: "已暂存求职意向修改。", change }
    }

    /* ---------- 布局/样式 ---------- */
    case "set_layout": {
      const layoutMode = str(args.layoutMode) === "inline" ? "inline" : str(args.layoutMode) === "grid" ? "grid" : undefined
      const itemsPerRow = int(args.itemsPerRow)
      const showLabels = bool(args.showLabels)
      const avatarShape = str(args.avatarShape) === "square" ? "square" : str(args.avatarShape) === "circle" ? "circle" : undefined
      const centerTitle = bool(args.centerTitle)
      const notes: string[] = []
      if (layoutMode) notes.push(`布局=${layoutMode}`)
      if (itemsPerRow) notes.push(`${itemsPerRow}列`)
      if (showLabels !== undefined) notes.push(showLabels ? "显示标签" : "隐藏标签")
      if (avatarShape) notes.push(`头像=${avatarShape === "square" ? "方形" : "圆形"}`)
      if (centerTitle !== undefined) notes.push(centerTitle ? "标题居中" : "标题左对齐")
      if (notes.length === 0) return { ok: false, message: "未提供任何布局修改" }
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "style",
        op: name,
        summary: "调整布局/样式",
        targetIds: ["personal", "title"],
        note: notes.join("，"),
        apply: (d) => ({
          ...d,
          centerTitle: centerTitle !== undefined ? centerTitle : d.centerTitle,
          personalInfoSection: {
            ...d.personalInfoSection,
            showPersonalInfoLabels:
              showLabels !== undefined ? showLabels : d.personalInfoSection.showPersonalInfoLabels,
            avatarShape: avatarShape ?? d.personalInfoSection.avatarShape,
            layout: {
              mode: layoutMode ?? d.personalInfoSection.layout?.mode ?? "grid",
              itemsPerRow: (itemsPerRow ?? d.personalInfoSection.layout?.itemsPerRow ?? 2) as 1 | 2 | 3 | 4 | 5 | 6,
            },
          },
        }),
      }
      return { ok: true, message: "已暂存布局调整。", change }
    }

    case "set_theme_color": {
      const color = str(args.color)
      if (!/^#?[0-9a-fA-F]{3,8}$/.test(color)) return { ok: false, message: "颜色格式无效" }
      const hex = color.startsWith("#") ? color : `#${color}`
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "style",
        op: name,
        summary: `设置主题色 ${hex}`,
        targetIds: [],
        note: hex,
        apply: (d) => ({ ...d, themeColor: hex }),
      }
      return { ok: true, message: `已暂存主题色 ${hex}。`, change }
    }

    /* ---------- 整篇生成 ---------- */
    case "replace_resume": {
      const draft = (args.draft || {}) as Args
      if (!draft.title || !Array.isArray(draft.modules))
        return { ok: false, message: "草稿缺少 title 或 modules" }
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "generate",
        op: name,
        summary: `整篇生成/重写简历「${str(draft.title)}」`,
        targetIds: [],
        note: `${(draft.modules as unknown[]).length} 个模块，将整体替换当前内容`,
        apply: (d) => draftToResumeData(draft, d),
      }
      return { ok: true, message: "已暂存整篇简历草稿，等待用户确认。", change }
    }

    /* ---------- 展示卡片 ---------- */
    case "present_score_report": {
      const card: AgentCard = {
        type: "score",
        overall: int(args.overall) ?? 0,
        dimensions: (Array.isArray(args.dimensions) ? args.dimensions : []).map((d) => {
          const o = (d || {}) as Args
          return { name: str(o.name), score: int(o.score) ?? 0, comment: str(o.comment) || undefined }
        }),
        strengths: Array.isArray(args.strengths) ? args.strengths.map(String) : undefined,
        suggestions: Array.isArray(args.suggestions) ? args.suggestions.map(String) : undefined,
      }
      return { ok: true, message: "已展示评分卡片。", card }
    }

    case "present_jd_match": {
      const card: AgentCard = {
        type: "jd",
        matchScore: int(args.matchScore) ?? 0,
        matchedKeywords: Array.isArray(args.matchedKeywords) ? args.matchedKeywords.map(String) : [],
        missingKeywords: Array.isArray(args.missingKeywords) ? args.missingKeywords.map(String) : [],
        summary: str(args.summary) || undefined,
        suggestions: (Array.isArray(args.suggestions) ? args.suggestions : []).map((s) => {
          const o = (s || {}) as Args
          return { section: str(o.section), advice: str(o.advice), prompt: str(o.prompt) || undefined }
        }),
      }
      return { ok: true, message: "已展示 JD 匹配卡片。", card }
    }

    case "present_interview_questions": {
      const card: AgentCard = {
        type: "interview",
        intro: str(args.intro) || undefined,
        questions: (Array.isArray(args.questions) ? args.questions : []).map((q) => {
          const o = (q || {}) as Args
          return { question: str(o.question), kind: str(o.kind) || undefined, hint: str(o.hint) || undefined }
        }),
      }
      return { ok: true, message: "已展示模拟面试卡片。", card }
    }

    default:
      return { ok: false, message: `未知工具：${name}` }
  }
}

export { READONLY_TOOLS }
