/** 简历实体 id 前缀：mod=模块, row=行, el=元素, info=个人信息项, jii=求职意向项 */
export const RESUME_ID_PREFIX = {
  module: "mod",
  row: "row",
  element: "el",
  personalInfo: "info",
  jobIntention: "jii",
} as const

const targetIdPattern = /^(?:element|row|module)#([^\s,，)）;；]+)/i

/** 生成唯一 id，格式 `{prefix}-{timestamp36}-{random}` */
export function createResumeId(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export const genId = createResumeId

export function createModuleId(): string {
  return createResumeId(RESUME_ID_PREFIX.module)
}

export function createRowId(): string {
  return createResumeId(RESUME_ID_PREFIX.row)
}

export function createElementId(): string {
  return createResumeId(RESUME_ID_PREFIX.element)
}

/**
 * 将 get_resume 大纲或工具参数中的 id 规范为存储用纯 id。
 * 接受 `module#mod-xxx` / `row#row-xxx` / `element#el-xxx` 或纯 id。
 */
export function normalizeResumeTargetId(id: string): string {
  const value = id.trim()
  if (!value) return ""
  const prefixed = value.match(targetIdPattern)
  return prefixed?.[1] || value.replace(/^(?:element|row|module)#/i, "")
}

export function normalizeResumeTargetIds(ids: string[]): string[] {
  return [...new Set(ids.map(normalizeResumeTargetId).filter(Boolean))]
}

export const RESUME_TARGET_ID_DESC =
  "目标 id：使用 get_resume 大纲中 module#/row#/element# 后面的纯 id；也接受带前缀的写法（如 module#mod-xxx）。"
