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

function getElementFormatLabel(content?: JSONContent | null): string {
  const firstText = findFirstTextNode(content)
  const firstBlock = findFirstBlock(content)
  const textStyle = firstText?.marks?.find((mark) => mark.type === "textStyle")?.attrs || {}
  const parts: string[] = []
  if (firstText?.marks?.some((mark) => mark.type === "bold")) parts.push("bold")
  if (typeof textStyle.fontSize === "string" && textStyle.fontSize) parts.push(textStyle.fontSize)
  if (typeof textStyle.fontFamily === "string" && textStyle.fontFamily) parts.push(textStyle.fontFamily)
  const align = firstBlock?.attrs?.textAlign
  if (typeof align === "string" && align) parts.push(`align=${align}`)
  return parts.length ? ` [${parts.join(", ")}]` : ""
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
            lines.push(`      row#${r.id} 标签行: [${(r.tags || []).join(", ")}]`)
          } else {
            lines.push(`      row#${r.id} ${r.columns}列:`)
            r.elements
              .slice()
              .sort((a, b) => a.columnIndex - b.columnIndex)
              .forEach((e) => {
                const text = docToText(e.content).replace(/\n/g, " ⏎ ")
                lines.push(`        element#${e.id} (列${e.columnIndex})${getElementFormatLabel(e.content)}: "${text}"`)
              })
          }
          void ri
        })
    })

  return lines.join("\n")
}
