import type {
  ResumeData,
  ResumeModule,
  ModuleContentRow,
  ModuleContentElement,
  PersonalInfoItem,
  JobIntentionItem,
  JSONContent,
} from "@/types/resume"
import type { AgentCard, ChangeSet, InterviewDimensionScores, ToolResult } from "./types"
import {
  buildResumeOutline,
  docToText,
  findElement,
  findModule,
  findRow,
  genId,
  getDocTextAlign,
  reindexOrder,
  withUpdatedElement,
  withUpdatedModule,
} from "./changeset"
import { READONLY_TOOLS } from "./tool-schemas"

type Args = Record<string, unknown>
type TextMark = NonNullable<JSONContent["marks"]>[number]

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback)
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined)
const int = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined
const clampDimension = (v: unknown): number | undefined => {
  const n = int(v)
  if (n === undefined) return undefined
  return Math.min(5, Math.max(1, n))
}

function parseInterviewDimensions(raw: unknown): InterviewDimensionScores | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const o = raw as Args
  const substance = clampDimension(o.substance)
  const structure = clampDimension(o.structure)
  const relevance = clampDimension(o.relevance)
  const credibility = clampDimension(o.credibility)
  const differentiation = clampDimension(o.differentiation)
  if (substance === undefined && structure === undefined && relevance === undefined && credibility === undefined && differentiation === undefined) {
    return undefined
  }
  return { substance, structure, relevance, credibility, differentiation }
}
const targetIdPattern = /^(?:element|row|module)#([^\s,，)）;；]+)/i
const normalizeTargetId = (id: string): string => {
  const value = id.trim()
  const prefixed = value.match(targetIdPattern)
  return prefixed?.[1] || value.replace(/^(?:element|row|module)#/i, "")
}

/** 为 JD 建议生成稳定 id（基于 section + advice），与 store 中的算法一致，便于跨版本跟踪状态 */
const suggestionKey = (section: string, advice: string): string => {
  const raw = `${section}::${advice}`
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0
  }
  return `sug-${(hash >>> 0).toString(36)}`
}

interface RowSpec {
  type?: "rich" | "tags"
  columns?: number
  texts?: string[]
  tags?: string[]
  formats?: ColumnFormat[]
}

interface ColumnFormat {
  bold?: boolean
  fontSize?: string
  fontFamily?: string
  textAlign?: string
}

function textStyleMark(format?: ColumnFormat): TextMark[] {
  const attrs: Record<string, string> = {}
  if (format?.fontSize) attrs.fontSize = format.fontSize.endsWith("pt") ? format.fontSize : `${format.fontSize}pt`
  if (format?.fontFamily) attrs.fontFamily = format.fontFamily
  return Object.keys(attrs).length ? [{ type: "textStyle", attrs }] : []
}

function marksFor(format?: ColumnFormat): TextMark[] | undefined {
  const marks = [...textStyleMark(format)]
  if (format?.bold) marks.unshift({ type: "bold" })
  return marks.length ? marks : undefined
}

function textToStyledDoc(text: string, format?: ColumnFormat): JSONContent {
  const align = format?.textAlign || "left"
  const marks = marksFor(format)
  const rawLines = (text ?? "").replace(/\r\n/g, "\n").split("\n")
  const blocks: JSONContent[] = []
  let listBuffer: string[] = []

  const textNode = (value: string): JSONContent => ({
    type: "text",
    text: value,
    ...(marks ? { marks } : {}),
  })

  const flushList = () => {
    if (listBuffer.length === 0) return
    blocks.push({
      type: "bulletList",
      content: listBuffer.map((item) => ({
        type: "listItem",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: align },
            content: item.length ? [textNode(item)] : [],
          },
        ],
      })),
    })
    listBuffer = []
  }

  for (const line of rawLines) {
    const bullet = line.match(/^\s*(?:[-•*])\s+(.*)$/)
    if (bullet) {
      listBuffer.push(bullet[1])
      continue
    }
    flushList()
    blocks.push({
      type: "paragraph",
      attrs: { textAlign: align },
      content: line.length ? [textNode(line)] : [],
    })
  }
  flushList()

  if (blocks.length === 0) blocks.push({ type: "paragraph", attrs: { textAlign: align }, content: [] })
  return { type: "doc", content: blocks }
}

function findFirstTextNode(content?: JSONContent | null): JSONContent | null {
  if (!content) return null
  if (content.type === "text") return content
  for (const child of content.content || []) {
    const found = findFirstTextNode(child)
    if (found) return found
  }
  return null
}

function findFirstBlock(content?: JSONContent | null): JSONContent | null {
  for (const block of content?.content || []) {
    if (block.type === "paragraph" || block.type === "heading") return block
    if (block.type === "bulletList" || block.type === "orderedList") {
      const nested = findFirstBlock(block)
      if (nested) return nested
    }
  }
  return null
}

function firstTextFormat(content?: JSONContent | null): ColumnFormat {
  const firstBlock = findFirstBlock(content)
  const firstText = findFirstTextNode(content)
  const textStyle = firstText?.marks?.find((mark) => mark.type === "textStyle")?.attrs || {}
  return {
    bold: Boolean(firstText?.marks?.some((mark) => mark.type === "bold")),
    fontSize: typeof textStyle.fontSize === "string" ? textStyle.fontSize : undefined,
    fontFamily: typeof textStyle.fontFamily === "string" ? textStyle.fontFamily : undefined,
    textAlign: typeof firstBlock?.attrs?.textAlign === "string" ? firstBlock.attrs.textAlign : undefined,
  }
}

function normalizeFormats(raw: unknown): ColumnFormat[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const o = (item || {}) as Args
    return {
      bold: bool(o.bold),
      fontSize: str(o.fontSize) || undefined,
      fontFamily: str(o.fontFamily) || undefined,
      textAlign: str(o.textAlign) || undefined,
    }
  })
}

function buildRow(spec: RowSpec, order: number, inherit?: ModuleContentRow | null): ModuleContentRow {
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
    const inherited = inherit?.columns === columns && inherit.elements[i] ? firstTextFormat(inherit.elements[i].content) : undefined
    const explicit = spec.formats?.[i]
    const format: ColumnFormat = {
      ...inherited,
      ...explicit,
      textAlign: explicit?.textAlign ?? inherited?.textAlign ?? align,
      bold: explicit?.bold ?? inherited?.bold ?? (i === 0 && columns >= 2 ? true : undefined),
    }
    elements.push({
      id: genId("el"),
      content: textToStyledDoc(texts[i] ?? "", format),
      columnIndex: i,
    })
  }
  return { id: genId("row"), type: "rich", columns, elements, order }
}

/** 结构变更的可视化预览：把一行/一个 spec 拍平成可读文本（用于 diff 卡） */
function specPreview(spec: RowSpec): string {
  if (spec.type === "tags") return `标签：${(spec.tags || []).map(String).join("、")}`
  return (spec.texts || []).map(String).filter(Boolean).join("  ｜  ")
}

function rowPreview(row: ModuleContentRow): string {
  if (row.type === "tags") return `标签：${(row.tags || []).join("、")}`
  return row.elements
    .map((e) => docToText(e.content))
    .filter(Boolean)
    .join("  ｜  ")
}

function modulePreview(title: string, rowTexts: string[]): string {
  const lines = rowTexts.filter(Boolean)
  return [`模块「${title}」`, ...lines].join("\n")
}

function moduleOrderPreview(modules: ResumeModule[]): string {
  return modules.map((m, i) => `${i + 1}. ${m.title}`).join("\n")
}

function rowSpec(raw: Args): RowSpec {
  return {
    type: str(raw.type) === "tags" ? "tags" : "rich",
    columns: int(raw.columns),
    texts: Array.isArray(raw.texts) ? raw.texts.map(String) : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : undefined,
    formats: normalizeFormats(raw.formats),
  }
}

function buildModule(title: string, rows: RowSpec[] | undefined, order: number): ResumeModule {
  const builtRows: ModuleContentRow[] = []
  ;(rows || []).forEach((row, i) => {
    builtRows.push(buildRow(row, i, builtRows[i - 1]))
  })
  return {
    id: genId("mod"),
    title: title || "新模块",
    icon: '<path fill="currentColor" d="M3 3h18v2H3zm0 4h18v2H3zm0 4h12v2H3zm0 4h18v2H3zm0 4h12v2H3z"/>',
    order,
    rows: builtRows,
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
      const rows = Array.isArray(mo.rows) ? mo.rows.map((row) => rowSpec((row || {}) as Args)) : undefined
      return buildModule(str(mo.title), rows, i)
    }),
    avatar: base.avatar,
    createdAt: base.createdAt || now,
    updatedAt: now,
  }
}

/** 执行单个工具，产出回传模型的文本结果，以及可选的变更/卡片 */
export async function executeTool(name: string, args: Args, data: ResumeData): Promise<ToolResult> {
  switch (name) {
    /* ---------- 只读 ---------- */
    case "get_resume": {
      return { ok: true, message: buildResumeOutline(data) }
    }

    case "research_company_interview": {
      const company = str(args.company)
      const role = str(args.role)
      const jd = str(args.jd)
      if (!company && !role && !jd) return { ok: false, message: "缺少公司、岗位或 JD 信息，无法研究。" }
      try {
        const res = await fetch("/api/agent/research", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            company,
            role,
            jd,
            resumeOutline: buildResumeOutline(data),
          }),
        })
        const payload = (await res.json().catch(() => ({}))) as { research?: string; error?: string; detail?: string }
        if (!res.ok) {
          return {
            ok: false,
            message: payload.error || payload.detail || `公司研究失败（${res.status}）`,
          }
        }
        return {
          ok: true,
          message: payload.research || "公司研究完成，但没有返回有效内容。",
        }
      } catch (err) {
        return {
          ok: false,
          message: `公司研究失败：${err instanceof Error ? err.message : String(err)}`,
        }
      }
    }

    /* ---------- 文本 ---------- */
    case "update_element_text": {
      const elementId = str(args.elementId)
      const loc = findElement(data, elementId)
      if (!loc) return { ok: false, message: `未找到元素 ${elementId}` }
      const before = docToText(loc.element.content)
      const after = str(args.text)
      const inherited = firstTextFormat(loc.element.content)
      const format = {
        ...inherited,
        ...normalizeFormats([args])[0],
        textAlign: str(args.textAlign) || inherited.textAlign || getDocTextAlign(loc.element.content),
      }
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "text",
        op: name,
        summary: str(args.summary) || `改写「${loc.module.title}」中的文本`,
        targetIds: [elementId],
        before,
        after,
        apply: (d) =>
          withUpdatedElement(d, elementId, (el) => ({ ...el, content: textToStyledDoc(after, format) })),
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
      const rows = Array.isArray(args.rows) ? args.rows.map((row) => rowSpec((row || {}) as Args)) : undefined
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "structure",
        op: name,
        summary: `新增模块「${title}」`,
        targetIds: [],
        after: modulePreview(title, (rows || []).map(specPreview)),
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
        before: modulePreview(module.title, module.rows.map(rowPreview)),
        note: "该模块及其全部内容将被移除",
        apply: (d) => ({ ...d, modules: reindexOrder(d.modules.filter((m) => m.id !== moduleId)) }),
      }
      return { ok: true, message: `已暂存删除模块「${module.title}」。`, change }
    }

    case "reorder_modules": {
      const ordered = Array.isArray(args.orderedModuleIds) ? args.orderedModuleIds.map(String) : []
      if (ordered.length === 0) return { ok: false, message: "未提供模块顺序" }
      const byId = new Map(data.modules.map((m) => [m.id, m]))
      const reordered: ResumeModule[] = []
      ordered.forEach((id) => {
        const m = byId.get(id)
        if (m) {
          reordered.push(m)
          byId.delete(id)
        }
      })
      data.modules.forEach((m) => {
        if (byId.has(m.id)) reordered.push(m)
      })
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "structure",
        op: name,
        summary: "重排模块顺序",
        targetIds: [],
        before: moduleOrderPreview(data.modules),
        after: moduleOrderPreview(reordered),
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
      const spec = rowSpec(args)
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "structure",
        op: name,
        summary: `在「${module.title}」新增一行`,
        targetIds: [moduleId],
        after: specPreview(spec) || "（空行）",
        note: afterRowId ? `插入到行 ${afterRowId} 之后` : "插入到模块末尾",
        apply: (d) =>
          withUpdatedModule(d, moduleId, (m) => {
            const rows = [...m.rows]
            const idx = afterRowId ? rows.findIndex((r) => r.id === afterRowId) : -1
            const insertAt = idx >= 0 ? idx + 1 : rows.length
            const inherit = idx >= 0 ? rows[idx] : rows[rows.length - 1]
            rows.splice(insertAt, 0, buildRow(spec, insertAt, inherit))
            return { ...m, rows: reindexOrder(rows) }
          }),
      }
      return { ok: true, message: "已暂存新增行。", change }
    }

    case "add_rows": {
      const moduleId = str(args.moduleId)
      const module = findModule(data, moduleId)
      if (!module) return { ok: false, message: `未找到模块 ${moduleId}` }
      const afterRowId = str(args.afterRowId)
      const specs = Array.isArray(args.rows) ? args.rows.map((row) => rowSpec((row || {}) as Args)) : []
      if (!specs.length) return { ok: false, message: "未提供要新增的行" }
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "structure",
        op: name,
        summary: `在「${module.title}」新增 ${specs.length} 行`,
        targetIds: [moduleId],
        after: specs.map((spec, i) => `${i + 1}. ${specPreview(spec) || "（空行）"}`).join("\n"),
        note: afterRowId ? `整体插入到行 ${afterRowId} 之后` : "整体插入到模块末尾",
        apply: (d) =>
          withUpdatedModule(d, moduleId, (m) => {
            const rows = [...m.rows]
            const idx = afterRowId ? rows.findIndex((r) => r.id === afterRowId) : -1
            const insertAt = idx >= 0 ? idx + 1 : rows.length
            const builtRows: ModuleContentRow[] = []
            specs.forEach((spec, offset) => {
              const previous = builtRows[offset - 1] || (idx >= 0 ? rows[idx] : rows[rows.length - 1]) || null
              builtRows.push(buildRow(spec, insertAt + offset, previous))
            })
            rows.splice(insertAt, 0, ...builtRows)
            return { ...m, rows: reindexOrder(rows) }
          }),
      }
      return { ok: true, message: `已暂存新增 ${specs.length} 行。`, change }
    }

    case "remove_row": {
      const moduleId = str(args.moduleId)
      const rowId = str(args.rowId)
      const module = findModule(data, moduleId)
      if (!module) return { ok: false, message: `未找到模块 ${moduleId}` }
      const row = module.rows.find((r) => r.id === rowId)
      const change: ChangeSet = {
        id: genId("chg"),
        kind: "structure",
        op: name,
        summary: `删除「${module.title}」中的一行`,
        targetIds: [moduleId],
        before: row ? rowPreview(row) : `行 ${rowId}`,
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
          const section = str(o.section)
          const advice = str(o.advice)
          return {
            id: suggestionKey(section, advice),
            section,
            advice,
            prompt: str(o.prompt) || undefined,
            targetIds: Array.isArray(o.targetIds) ? o.targetIds.map(String).map(normalizeTargetId).filter(Boolean) : undefined,
            status: "pending" as const,
          }
        }),
      }
      return { ok: true, message: "已展示 JD 匹配卡片。", card }
    }

    case "present_career_directions": {
      const card: AgentCard = {
        type: "discover",
        summary: str(args.summary) || undefined,
        directions: (Array.isArray(args.directions) ? args.directions : []).map((d) => {
          const o = (d || {}) as Args
          return {
            title: str(o.title),
            matchScore: int(o.matchScore) ?? 0,
            reason: str(o.reason) || undefined,
            positions: Array.isArray(o.positions) ? o.positions.map(String) : undefined,
            gaps: Array.isArray(o.gaps) ? o.gaps.map(String) : undefined,
          }
        }),
      }
      return { ok: true, message: "已展示岗位方向推荐卡片。", card }
    }

    case "plan_interview_questions": {
      const questions = (Array.isArray(args.questions) ? args.questions : []).map((q, index) => {
        const o = (q || {}) as Args
        const hints = Array.isArray(o.followUpHints) ? o.followUpHints.map(String).filter(Boolean) : []
        return [
          `${index + 1}. ${str(o.question)}`,
          str(o.kind) ? `类别：${str(o.kind)}` : "",
          str(o.difficulty) ? `难度：${str(o.difficulty)}` : "",
          str(o.targetDimension) ? `考察维度：${str(o.targetDimension)}` : "",
          str(o.rationale) ? `内部理由：${str(o.rationale)}` : "",
          hints.length ? `追问参考：${hints.join("；")}` : "",
        ]
          .filter(Boolean)
          .join("；")
      })
      return {
        ok: true,
        message: [
          "已记录本场模拟面试核心问题计划。不要一次性展示给用户；后续请按顺序调用 present_interview_question，每次只展示一道题。",
          ...questions,
        ].join("\n"),
      }
    }

    case "present_interview_question": {
      const card: AgentCard = {
        type: "interview",
        intro: str(args.intro) || undefined,
        currentIndex: int(args.currentIndex) ?? 1,
        total: int(args.total) ?? 1,
        questions: [
          {
            question: str(args.question),
            kind: str(args.kind) || undefined,
          },
        ],
      }
      return { ok: true, message: "已展示当前模拟面试题。", card }
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

    case "terminate_interview": {
      const reason = str(args.reason) || "综合评估未达标"
      const feedback = str(args.feedback)
      return {
        ok: true,
        message: [
          "已终止本场模拟面试。",
          feedback ? `对用户说明：${feedback}` : "",
          `判定依据：${reason}`,
          "不要继续调用 present_interview_question 或追问。",
        ]
          .filter(Boolean)
          .join("\n"),
        terminateInterview: true,
      }
    }

    case "present_interview_report": {
      const card: AgentCard = {
        type: "interview_report",
        overall: int(args.overall) ?? 0,
        summary: str(args.summary) || undefined,
        items: (Array.isArray(args.items) ? args.items : []).map((it) => {
          const o = (it || {}) as Args
          const dimensions = parseInterviewDimensions(o.dimensions)
          return {
            question: str(o.question),
            score: int(o.score) ?? 0,
            comment: str(o.comment) || undefined,
            dimensions,
          }
        }),
        strengths: Array.isArray(args.strengths) ? args.strengths.map(String) : undefined,
        improvements: Array.isArray(args.improvements) ? args.improvements.map(String) : undefined,
      }
      return { ok: true, message: "已展示面试表现报告。", card }
    }

    default:
      return { ok: false, message: `未知工具：${name}` }
  }
}

export { READONLY_TOOLS }
