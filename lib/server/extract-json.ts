export function extractJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) throw new Error("模型没有返回内容")
  try {
    return JSON.parse(trimmed)
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
    if (fenced?.[1]) return JSON.parse(fenced[1])
    const start = trimmed.indexOf("{")
    const end = trimmed.lastIndexOf("}")
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
    throw new Error("模型没有返回合法 JSON")
  }
}
