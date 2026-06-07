import type {
  JSONContent,
  ResumeData,
  ResumeModule,
  ModuleContentRow,
  ModuleContentElement,
} from "@/types/resume"

/** 生成稳定的唯一 id */
export function genId(prefix = "ai"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 提取 Tiptap 文档的纯文本（列表项以 • 前缀，块级以换行分隔） */
export function docToText(content?: JSONContent | null): string {
  if (!content) return ""

  const getInline = (node: JSONContent): string => {
    if (typeof node.text === "string") return node.text
    if (Array.isArray(node.content)) return node.content.map(getInline).join("")
    return ""
  }

  const lines: string[] = []
  const blocks = content.content || []
  for (const block of blocks) {
    if (block.type === "bulletList" || block.type === "orderedList") {
      const items = block.content || []
      items.forEach((li) => {
        lines.push("• " + (li.content || []).map(getInline).join(""))
      })
    } else {
      lines.push(getInline(block))
    }
  }
  return lines.join("\n").trim()
}

/** 读取元素首段的对齐方式（用于改写时保留对齐） */
export function getDocTextAlign(content?: JSONContent | null): string | undefined {
  const first = content?.content?.find((n) => n.type === "paragraph")
  const align = first?.attrs?.textAlign
  return typeof align === "string" ? align : undefined
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

interface TextStyleSnapshot {
  bold: boolean
  italic: boolean
  underline: boolean
  code: boolean
  fontSize?: string
  fontFamily?: string
  color?: string
}

const DEFAULT_RENDER_STYLE =
  "渲染默认样式: 简历标题=16pt/bold; 模块标题=13pt/bold; 模块正文/列表=默认正文(text-sm, 屏幕约14px/10.5pt, 打印/PDF约10pt, 行高1.6, 段/列表间距0.6em或5pt); 个人信息=10pt; 标签=text-xs。若元素样式为 default-body，新增同类内容通常不要在 formats 中手动写 fontSize/fontFamily。"

function getTextStyleSnapshot(node: JSONContent): TextStyleSnapshot | null {
  if (node.type !== "text") return null
  const textStyle = node.marks?.find((mark) => mark.type === "textStyle")?.attrs || {}
  return {
    bold: Boolean(node.marks?.some((mark) => mark.type === "bold")),
    italic: Boolean(node.marks?.some((mark) => mark.type === "italic")),
    underline: Boolean(node.marks?.some((mark) => mark.type === "underline")),
    code: Boolean(node.marks?.some((mark) => mark.type === "code")),
    fontSize: typeof textStyle.fontSize === "string" && textStyle.fontSize ? textStyle.fontSize : undefined,
    fontFamily: typeof textStyle.fontFamily === "string" && textStyle.fontFamily ? textStyle.fontFamily : undefined,
    color: typeof textStyle.color === "string" && textStyle.color ? textStyle.color : undefined,
  }
}

function collectTextStyleSnapshots(content?: JSONContent | null, snapshots: TextStyleSnapshot[] = []): TextStyleSnapshot[] {
  if (!content || snapshots.length >= 8) return snapshots
  const snapshot = getTextStyleSnapshot(content)
  if (snapshot) snapshots.push(snapshot)
  for (const child of content.content || []) {
    collectTextStyleSnapshots(child, snapshots)
    if (snapshots.length >= 8) break
  }
  return snapshots
}

function collectBlockTypes(content?: JSONContent | null, types: Set<string> = new Set()): Set<string> {
  if (!content) return types
  if (content.type === "paragraph" || content.type === "heading" || content.type === "bulletList" || content.type === "orderedList") {
    types.add(content.type)
  }
  for (const child of content.content || []) collectBlockTypes(child, types)
  return types
}

function styleKey(style: TextStyleSnapshot): string {
  return [
    style.bold ? "bold" : "normal",
    style.italic ? "italic" : "no-italic",
    style.underline ? "underline" : "no-underline",
    style.code ? "code" : "no-code",
    style.fontSize || "default-size",
    style.fontFamily || "default-font",
    style.color || "default-color",
  ].join("|")
}

function getElementStyleLabel(content?: JSONContent | null): string {
  const firstText = findFirstTextNode(content)
  const firstBlock = findFirstBlock(content)
  const parts: string[] = []
  const firstStyle = firstText ? getTextStyleSnapshot(firstText) : null
  const textStyles = collectTextStyleSnapshots(content)
  const uniqueStyleCount = new Set(textStyles.map(styleKey)).size
  const blockTypes = [...collectBlockTypes(content)]

  if (firstStyle?.bold) parts.push("fontWeight=bold")
  else parts.push("fontWeight=normal")
  if (firstStyle?.italic) parts.push("italic")
  if (firstStyle?.underline) parts.push("underline")
  if (firstStyle?.code) parts.push("code")

  parts.push(firstStyle?.fontSize ? `fontSize=${firstStyle.fontSize}(explicit)` : "fontSize=default-body")
  parts.push(firstStyle?.fontFamily ? `fontFamily=${firstStyle.fontFamily}(explicit)` : "fontFamily=default-app")
  if (firstStyle?.color) parts.push(`color=${firstStyle.color}`)

  const align = firstBlock?.attrs?.textAlign
  parts.push(`textAlign=${typeof align === "string" && align ? align : "left"}`)
  if (blockTypes.length) parts.push(`blocks=${blockTypes.join("+")}`)
  if (uniqueStyleCount > 1) parts.push(`mixedStyles=${uniqueStyleCount}`)

  return ` style{${parts.join(", ")}}`
}

/**
 * 由纯文本构建 Tiptap 文档。
 * - 以换行拆分为多个段落
 * - 以「- 」或「• 」开头的连续行合并为无序列表
 * - 保留可选的对齐方式
 */
export function textToDoc(text: string, textAlign?: string): JSONContent {
  const align = textAlign || "left"
  const rawLines = (text ?? "").replace(/\r\n/g, "\n").split("\n")
  const blocks: JSONContent[] = []
  let listBuffer: string[] = []

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
            content: item.length ? [{ type: "text", text: item }] : [],
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
      content: line.length ? [{ type: "text", text: line }] : [],
    })
  }
  flushList()

  if (blocks.length === 0) {
    blocks.push({ type: "paragraph", attrs: { textAlign: align }, content: [] })
  }
  return { type: "doc", content: blocks }
}

/* ---------- 不可变查找/更新工具 ---------- */

export interface ElementLocation {
  module: ResumeModule
  row: ModuleContentRow
  element: ModuleContentElement
}

export function findElement(data: ResumeData, elementId: string): ElementLocation | null {
  for (const module of data.modules) {
    for (const row of module.rows) {
      const element = row.elements.find((e) => e.id === elementId)
      if (element) return { module, row, element }
    }
  }
  return null
}

export function findModule(data: ResumeData, moduleId: string): ResumeModule | null {
  return data.modules.find((m) => m.id === moduleId) || null
}

export function findRow(
  data: ResumeData,
  rowId: string,
): { module: ResumeModule; row: ModuleContentRow } | null {
  for (const module of data.modules) {
    const row = module.rows.find((r) => r.id === rowId)
    if (row) return { module, row }
  }
  return null
}

/** 替换某元素的内容（不可变） */
export function withUpdatedElement(
  data: ResumeData,
  elementId: string,
  updater: (el: ModuleContentElement) => ModuleContentElement,
): ResumeData {
  return {
    ...data,
    modules: data.modules.map((m) => ({
      ...m,
      rows: m.rows.map((r) => ({
        ...r,
        elements: r.elements.map((e) => (e.id === elementId ? updater(e) : e)),
      })),
    })),
  }
}

/** 更新某个模块（不可变） */
export function withUpdatedModule(
  data: ResumeData,
  moduleId: string,
  updater: (m: ResumeModule) => ResumeModule,
): ResumeData {
  return {
    ...data,
    modules: data.modules.map((m) => (m.id === moduleId ? updater(m) : m)),
  }
}

/** 重排 order 字段 */
export function reindexOrder<T extends { order: number }>(list: T[]): T[] {
  return list.map((item, idx) => ({ ...item, order: idx }))
}

/** 生成简历结构大纲（供模型理解当前状态，带 id） */
export function buildResumeOutline(data: ResumeData): string {
  const lines: string[] = []
  lines.push(`简历标题: "${data.title}"${data.centerTitle ? "（居中）" : "（左对齐）"}`)
  if (data.themeColor) lines.push(`主题色: ${data.themeColor}`)
  lines.push(DEFAULT_RENDER_STYLE)

  const ji = data.jobIntentionSection
  if (ji?.enabled && ji.items?.length) {
    const items = ji.items
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((i) => `${i.label}=${i.type === "salary" ? `${i.salaryRange?.min ?? ""}-${i.salaryRange?.max ?? ""}` : i.value}`)
      .join(", ")
    lines.push(`求职意向: ${items}`)
  }

  const pi = data.personalInfoSection
  if (pi?.personalInfo?.length) {
    const items = pi.personalInfo
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((i) => `${i.label}=${i.value.content}`)
      .join(", ")
    lines.push(`个人信息(${pi.layout?.mode}/${pi.layout?.itemsPerRow ?? 2}列): ${items}`)
  }

  lines.push("模块:")
  data.modules
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((m, mi) => {
      lines.push(`  [${mi}] module#${m.id} 标题="${m.title}" (${m.rows.length}行)`)
      m.rows
        .slice()
        .sort((a, b) => a.order - b.order)
        .forEach((r, ri) => {
          if (r.type === "tags") {
            lines.push(`      row#${r.id} 标签行 style{fontSize=text-xs, pill, wrap}: [${(r.tags || []).join(", ")}]`)
          } else {
            lines.push(`      row#${r.id} ${r.columns}列 layout{grid=${r.columns}列, columnGap=0.75rem, rowGap=0.6em}:`)
            r.elements
              .slice()
              .sort((a, b) => a.columnIndex - b.columnIndex)
              .forEach((e) => {
                const text = docToText(e.content).replace(/\n/g, " ⏎ ")
                lines.push(`        element#${e.id} (列${e.columnIndex})${getElementStyleLabel(e.content)}: "${text}"`)
              })
          }
          void ri
        })
    })

  return lines.join("\n")
}
