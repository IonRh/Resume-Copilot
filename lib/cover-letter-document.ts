import type { JSONContent } from "@/types/resume"
import { docToText, textToDoc } from "@/lib/resume-core/document"

export function emptyCoverLetterDoc(): JSONContent {
  return { type: "doc", content: [{ type: "paragraph", content: [] }] }
}

type InlineMark = "bold" | "italic" | "strike"

function withMark(nodes: JSONContent[], mark: InlineMark): JSONContent[] {
  return nodes.map((node) => {
    if (node.type !== "text") return node
    const marks = [...(node.marks || []), { type: mark }]
    return { ...node, marks }
  })
}

function parseInline(text: string): JSONContent[] {
  const nodes: JSONContent[] = []
  let remaining = text

  while (remaining.length > 0) {
    const patterns: Array<{ re: RegExp; mark?: InlineMark; link?: boolean }> = [
      { re: /^\*\*(.+?)\*\*/, mark: "bold" },
      { re: /^__(.+?)__/, mark: "bold" },
      { re: /^\*(.+?)\*/, mark: "italic" },
      { re: /^_(.+?)_/, mark: "italic" },
      { re: /^~~(.+?)~~/, mark: "strike" },
    ]

    let matched = false
    for (const { re, mark } of patterns) {
      const m = remaining.match(re)
      if (!m) continue
      nodes.push(...withMark(parseInline(m[1]), mark!))
      remaining = remaining.slice(m[0].length)
      matched = true
      break
    }
    if (matched) continue

    const link = remaining.match(/^\[(.+?)\]\((.+?)\)/)
    if (link) {
      nodes.push({
        type: "text",
        text: link[1],
        marks: [{ type: "link", attrs: { href: link[2] } }],
      })
      remaining = remaining.slice(link[0].length)
      continue
    }

    const size = remaining.match(/^\{(\d+)pt\}(.+?)\{\/\1pt\}/)
    if (size) {
      nodes.push({
        type: "text",
        text: size[2],
        marks: [{ type: "textStyle", attrs: { fontSize: `${size[1]}pt` } }],
      })
      remaining = remaining.slice(size[0].length)
      continue
    }

    const plain = remaining.match(/^[^*_~\[{]+/)
    if (plain) {
      nodes.push({ type: "text", text: plain[0] })
      remaining = remaining.slice(plain[0].length)
      continue
    }

    nodes.push({ type: "text", text: remaining[0] })
    remaining = remaining.slice(1)
  }

  return nodes
}

function paragraph(text: string, attrs?: Record<string, string>): JSONContent {
  const inline = parseInline(text.trim())
  return {
    type: "paragraph",
    ...(attrs ? { attrs } : {}),
    content: inline.length ? inline : [],
  }
}

function heading(level: 2 | 3, text: string): JSONContent {
  return {
    type: "heading",
    attrs: { level },
    content: parseInline(text.trim()),
  }
}

function listItem(text: string): JSONContent {
  return {
    type: "listItem",
    content: [paragraph(text)],
  }
}

/** 将 Agent 输出的 Markdown 转为 Tiptap JSON */
export function markdownToDoc(markdown: string): JSONContent {
  const normalized = (markdown ?? "").replace(/\r\n/g, "\n").trim()
  if (!normalized) return emptyCoverLetterDoc()

  const lines = normalized.split("\n")
  const blocks: JSONContent[] = []
  let bulletBuffer: string[] = []
  let orderedBuffer: string[] = []

  const flushBullets = () => {
    if (!bulletBuffer.length) return
    blocks.push({
      type: "bulletList",
      content: bulletBuffer.map(listItem),
    })
    bulletBuffer = []
  }

  const flushOrdered = () => {
    if (!orderedBuffer.length) return
    blocks.push({
      type: "orderedList",
      content: orderedBuffer.map(listItem),
    })
    orderedBuffer = []
  }

  const flushLists = () => {
    flushBullets()
    flushOrdered()
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (!trimmed) {
      flushLists()
      continue
    }

    const h3 = trimmed.match(/^###\s+(.+)$/)
    if (h3) {
      flushLists()
      blocks.push(heading(3, h3[1]))
      continue
    }

    const h2 = trimmed.match(/^##\s+(.+)$/)
    if (h2) {
      flushLists()
      blocks.push(heading(2, h2[1]))
      continue
    }

    const quote = trimmed.match(/^>\s+(.+)$/)
    if (quote) {
      flushLists()
      blocks.push({
        type: "blockquote",
        content: [paragraph(quote[1])],
      })
      continue
    }

    const bullet = trimmed.match(/^[-*•]\s+(.+)$/)
    if (bullet) {
      flushOrdered()
      bulletBuffer.push(bullet[1])
      continue
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/)
    if (ordered) {
      flushBullets()
      orderedBuffer.push(ordered[1])
      continue
    }

    flushLists()
    blocks.push(paragraph(trimmed))
  }

  flushLists()

  if (!blocks.length) return emptyCoverLetterDoc()
  return { type: "doc", content: blocks }
}

/** 兼容旧版纯文本草稿 */
export function normalizeCoverLetterBody(input: {
  body?: string
  bodyContent?: JSONContent | null
}): { body: string; bodyContent: JSONContent } {
  if (input.bodyContent?.type === "doc") {
    return {
      bodyContent: input.bodyContent,
      body: docToText(input.bodyContent),
    }
  }
  const body = input.body?.trim() || ""
  const bodyContent = body ? markdownToDoc(body) : emptyCoverLetterDoc()
  return { body, bodyContent }
}

export { docToText, textToDoc }

export function coverLetterToPlainText(draft: {
  title?: string
  body?: string
  bodyContent?: JSONContent | null
  shortVersion?: string
}): string {
  const title = draft.title?.trim()
  const body = draft.body?.trim() || docToText(draft.bodyContent)
  const parts = [title, body].filter(Boolean)
  return parts.join("\n\n").trim()
}
