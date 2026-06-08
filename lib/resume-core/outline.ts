import type { JSONContent, ResumeData } from "@/types/resume"
import {
  collectBlockTypes,
  collectTextStyleSnapshots,
  docToText,
  findFirstBlock,
  findFirstTextNode,
  getTextStyleSnapshot,
  type TextStyleSnapshot,
} from "./document"
import { sortedByColumn, sortedByOrder } from "./operations"

const DEFAULT_RENDER_STYLE =
  "渲染默认样式: 简历标题=16pt/bold; 模块标题=13pt/bold; 模块正文/列表=默认正文(text-sm, 屏幕约14px/10.5pt, 打印/PDF约10pt, 行高1.6, 段/列表间距0.6em或5pt); 个人信息=10pt; 标签=text-xs。若元素样式为 default-body，新增同类内容通常不要在 formats 中手动写 fontSize/fontFamily。"

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

export function buildResumeOutline(data: ResumeData): string {
  const lines: string[] = []
  lines.push(`简历标题: "${data.title}"${data.centerTitle ? "（居中）" : "（左对齐）"}`)
  if (data.themeColor) lines.push(`主题色: ${data.themeColor}`)
  lines.push(DEFAULT_RENDER_STYLE)

  const jobIntention = data.jobIntentionSection
  if (jobIntention?.enabled && jobIntention.items?.length) {
    const items = sortedByOrder(jobIntention.items)
      .map((item) =>
        `${item.label}=${item.type === "salary" ? `${item.salaryRange?.min ?? ""}-${item.salaryRange?.max ?? ""}` : item.value}`,
      )
      .join(", ")
    lines.push(`求职意向: ${items}`)
  }

  const personalInfo = data.personalInfoSection
  if (personalInfo?.personalInfo?.length) {
    const items = sortedByOrder(personalInfo.personalInfo)
      .map((item) => `${item.label}=${item.value.content}`)
      .join(", ")
    lines.push(`个人信息(${personalInfo.layout?.mode}/${personalInfo.layout?.itemsPerRow ?? 2}列): ${items}`)
  }

  lines.push("模块:")
  sortedByOrder(data.modules).forEach((module, moduleIndex) => {
    lines.push(`  [${moduleIndex}] module#${module.id} 标题="${module.title}" (${module.rows.length}行)`)
    sortedByOrder(module.rows).forEach((row) => {
      if (row.type === "tags") {
        lines.push(`      row#${row.id} 标签行 style{fontSize=text-xs, pill, wrap}: [${(row.tags || []).join(", ")}]`)
        return
      }
      lines.push(`      row#${row.id} ${row.columns}列 layout{grid=${row.columns}列, columnGap=0.75rem, rowGap=0.6em}:`)
      sortedByColumn(row.elements).forEach((element) => {
        const text = docToText(element.content).replace(/\n/g, " ⏎ ")
        lines.push(`        element#${element.id} (列${element.columnIndex})${getElementStyleLabel(element.content)}: "${text}"`)
      })
    })
  })

  return lines.join("\n")
}
