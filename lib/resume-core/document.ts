import type { JSONContent } from "@/types/resume"

export type TextMark = NonNullable<JSONContent["marks"]>[number]

export interface ColumnFormat {
  bold?: boolean
  fontSize?: string
  fontFamily?: string
  textAlign?: string
}

export interface TextStyleSnapshot {
  bold: boolean
  italic: boolean
  underline: boolean
  code: boolean
  fontSize?: string
  fontFamily?: string
  color?: string
}

function normalizeFontSize(fontSize?: string): string | undefined {
  const value = fontSize?.trim()
  if (!value) return undefined
  return value.endsWith("pt") ? value : `${value}pt`
}

function textStyleMarks(format?: ColumnFormat): TextMark[] {
  const attrs: Record<string, string> = {}
  const fontSize = normalizeFontSize(format?.fontSize)
  if (fontSize) attrs.fontSize = fontSize
  if (format?.fontFamily) attrs.fontFamily = format.fontFamily
  return Object.keys(attrs).length ? [{ type: "textStyle", attrs }] : []
}

export function marksForFormat(format?: ColumnFormat): TextMark[] | undefined {
  const marks = [...textStyleMarks(format)]
  if (format?.bold) marks.unshift({ type: "bold" })
  return marks.length ? marks : undefined
}

export function textToStyledDoc(text: string, format?: ColumnFormat): JSONContent {
  const align = format?.textAlign || "left"
  const marks = marksForFormat(format)
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
    const bullet = line.match(/^\s*(?:[-\u2022*])\s+(.*)$/)
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

export function textToDoc(text: string, textAlign?: string): JSONContent {
  return textToStyledDoc(text, { textAlign })
}

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
        lines.push(`\u2022 ${(li.content || []).map(getInline).join("")}`)
      })
    } else {
      lines.push(getInline(block))
    }
  }
  return lines.join("\n").trim()
}

export function findFirstTextNode(content?: JSONContent | null): JSONContent | null {
  if (!content) return null
  if (content.type === "text") return content
  for (const child of content.content || []) {
    const found = findFirstTextNode(child)
    if (found) return found
  }
  return null
}

export function findFirstBlock(content?: JSONContent | null): JSONContent | null {
  for (const block of content?.content || []) {
    if (block.type === "paragraph" || block.type === "heading") return block
    if (block.type === "bulletList" || block.type === "orderedList") {
      const nested = findFirstBlock(block)
      if (nested) return nested
    }
  }
  return null
}

export function getDocTextAlign(content?: JSONContent | null): string | undefined {
  const align = findFirstBlock(content)?.attrs?.textAlign
  return typeof align === "string" ? align : undefined
}

export function getTextStyleSnapshot(node: JSONContent): TextStyleSnapshot | null {
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

export function collectTextStyleSnapshots(
  content?: JSONContent | null,
  snapshots: TextStyleSnapshot[] = [],
): TextStyleSnapshot[] {
  if (!content || snapshots.length >= 8) return snapshots
  const snapshot = getTextStyleSnapshot(content)
  if (snapshot) snapshots.push(snapshot)
  for (const child of content.content || []) {
    collectTextStyleSnapshots(child, snapshots)
    if (snapshots.length >= 8) break
  }
  return snapshots
}

export function collectBlockTypes(content?: JSONContent | null, types: Set<string> = new Set()): Set<string> {
  if (!content) return types
  if (
    content.type === "paragraph" ||
    content.type === "heading" ||
    content.type === "bulletList" ||
    content.type === "orderedList"
  ) {
    types.add(content.type)
  }
  for (const child of content.content || []) collectBlockTypes(child, types)
  return types
}

export function getFirstTextFormat(content?: JSONContent | null): ColumnFormat {
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
