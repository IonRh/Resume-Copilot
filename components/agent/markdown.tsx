"use client"

import { useMemo, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * 轻量 Markdown 渲染器（零三方依赖），覆盖 Agent 输出常见语法：
 * 标题 / 加粗 / 斜体 / 行内代码 / 代码块 / 有序·无序列表 / 引用 / 分隔线 / 链接 / 表格。
 * 仅面向「可信」的模型输出，未做 HTML 转义之外的安全增强；不渲染原始 HTML。
 */

const INLINE_RE =
  /(`[^`]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]\n]+\]\([^)\n]+\))/

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let k = 0
  while (rest.length) {
    const m = INLINE_RE.exec(rest)
    if (!m) {
      out.push(rest)
      break
    }
    if (m.index > 0) out.push(rest.slice(0, m.index))
    const tok = m[0]
    if (tok.startsWith("`")) {
      out.push(
        <code key={k++} className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      )
    } else if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(
        <strong key={k++} className="font-semibold">
          {renderInline(tok.slice(2, -2))}
        </strong>,
      )
    } else if (tok.startsWith("*") || tok.startsWith("_")) {
      out.push(<em key={k++}>{renderInline(tok.slice(1, -1))}</em>)
    } else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)
      if (lm) {
        out.push(
          <a
            key={k++}
            href={lm[2]}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {renderInline(lm[1])}
          </a>,
        )
      } else {
        out.push(tok)
      }
    } else {
      out.push(tok)
    }
    rest = rest.slice(m.index + tok.length)
  }
  return out
}

const BLOCK_START_RE = /^(\s*```|#{1,6}\s|>\s?|\s*[-*+]\s+|\s*\d+[.)]\s+|(-{3,}|\*{3,}|_{3,})\s*$)/

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim())
}

function parseBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n")
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }

    // 代码块
    if (/^\s*```/.test(line)) {
      i++
      const buf: string[] = []
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      i++ // 跳过结束围栏
      blocks.push(
        <pre
          key={key++}
          className="my-1.5 overflow-x-auto rounded-md bg-foreground/10 p-2 text-xs leading-relaxed"
        >
          <code className="font-mono">{buf.join("\n")}</code>
        </pre>,
      )
      continue
    }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(line.trim())
    if (h) {
      const lvl = h[1].length
      const cls =
        lvl <= 2
          ? "mt-2 mb-1 text-sm font-semibold"
          : lvl === 3
            ? "mt-2 mb-1 text-[13px] font-semibold"
            : "mt-1.5 mb-0.5 text-xs font-semibold text-muted-foreground"
      blocks.push(
        <p key={key++} className={cls}>
          {renderInline(h[2])}
        </p>,
      )
      i++
      continue
    }

    // 分隔线
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push(<hr key={key++} className="my-2 border-border" />)
      i++
      continue
    }

    // 引用
    if (/^>\s?/.test(line.trim())) {
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        buf.push(lines[i].trim().replace(/^>\s?/, ""))
        i++
      }
      blocks.push(
        <blockquote
          key={key++}
          className="my-1.5 border-l-2 border-primary/40 pl-2.5 text-muted-foreground"
        >
          {renderInline(buf.join("\n"))}
        </blockquote>,
      )
      continue
    }

    // 表格（GFM）：当前行含 | 且下一行为分隔行
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /\|?\s*:?-{2,}/.test(lines[i + 1]) &&
      lines[i + 1].includes("-")
    ) {
      const header = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]))
        i++
      }
      blocks.push(
        <div key={key++} className="my-1.5 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {header.map((c, ci) => (
                  <th key={ci} className="border border-border bg-muted/50 px-2 py-1 text-left font-semibold">
                    {renderInline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border border-border px-2 py-1 align-top">
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""))
        i++
      }
      blocks.push(
        <ul key={key++} className="my-1 list-disc space-y-0.5 pl-5">
          {items.map((it, idx) => (
            <li key={idx} className="leading-relaxed">
              {renderInline(it)}
            </li>
          ))}
        </ul>,
      )
      continue
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""))
        i++
      }
      blocks.push(
        <ol key={key++} className="my-1 list-decimal space-y-0.5 pl-5">
          {items.map((it, idx) => (
            <li key={idx} className="leading-relaxed">
              {renderInline(it)}
            </li>
          ))}
        </ol>,
      )
      continue
    }

    // 段落（直到空行或新块起始）
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !BLOCK_START_RE.test(lines[i])) {
      para.push(lines[i].trim())
      i++
    }
    blocks.push(
      <p key={key++} className="my-1 leading-relaxed">
        {para.flatMap((l, idx) =>
          idx === 0 ? renderInline(l) : [<br key={`br${idx}`} />, ...renderInline(l)],
        )}
      </p>,
    )
  }

  return blocks
}

export function Markdown({ content, className }: { content: string; className?: string }) {
  const blocks = useMemo(() => parseBlocks(content), [content])
  return (
    <div className={cn("text-sm [&>:first-child]:mt-0 [&>:last-child]:mb-0", className)}>{blocks}</div>
  )
}

export default Markdown
