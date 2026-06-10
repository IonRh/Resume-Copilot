import type { ResumeData } from "@/types/resume"
import { normalizeResumeTargetId, normalizeResumeTargetIds } from "./id"
import { findElement, findModule, findRow } from "./operations"

const PSEUDO_TARGET_SELECTORS: Record<string, string> = {
  title: '[data-target-id="title"]',
  personal: '[data-target-id="personal"]',
  jobIntention: '[data-target-id="jobIntention"]',
}

const PSEUDO_TARGETS = new Set(Object.keys(PSEUDO_TARGET_SELECTORS))

function attrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function isKnownTarget(data: ResumeData, id: string): boolean {
  if (PSEUDO_TARGETS.has(id)) return true
  return Boolean(findModule(data, id) || findRow(data, id) || findElement(data, id))
}

function matchModuleBySection(data: ResumeData, section: string): string | null {
  const hint = section.trim()
  if (!hint) return null
  const modules = data.modules || []
  const exact = modules.find((m) => m.title === hint)
  if (exact) return exact.id
  const partial = modules.find((m) => m.title.includes(hint) || hint.includes(m.title))
  return partial?.id ?? null
}

/** 将 targetIds 规范并校验；无效时按建议 section 名回退匹配模块 */
export function resolveResumeTargetIds(
  data: ResumeData,
  ids: string[],
  sectionHint?: string,
): string[] {
  const normalized = normalizeResumeTargetIds(ids)
  const resolved = normalized.filter((id) => isKnownTarget(data, id))
  if (resolved.length) return resolved
  const fromSection = sectionHint ? matchModuleBySection(data, sectionHint) : null
  if (fromSection) return [fromSection]
  return normalized
}

/** 在简历预览 DOM 中查找定位/高亮目标（依赖 data-* 属性） */
export function findPreviewTarget(id: string, root?: ParentNode | null): Element | null {
  if (typeof document === "undefined") return null
  const scope = root ?? document.querySelector(".rw-preview") ?? document
  const normalized = normalizeResumeTargetId(id)
  if (!normalized) return null
  const value = attrValue(normalized)

  const pseudo = PSEUDO_TARGET_SELECTORS[normalized]
  if (pseudo) {
    const target = scope.querySelector(pseudo)
    if (target) return target
  }

  const byTargetId = scope.querySelector(`[data-target-id="${value}"]`)
  if (byTargetId) return byTargetId

  const element = scope.querySelector(`[data-element-id="${value}"]`)
  if (element) return element

  const row = scope.querySelector(`[data-row-id="${value}"]`)
  if (row) return row

  const module = scope.querySelector(`[data-module-id="${value}"]`)
  return module?.querySelector('[data-role="module-title"]') || module
}
