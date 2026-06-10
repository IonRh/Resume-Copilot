import type {
  ModuleContentElement,
  ModuleContentRow,
  ResumeData,
  ResumeModule,
} from "@/types/resume"
import { normalizeResumeTargetId } from "./id"

export interface ElementLocation {
  module: ResumeModule
  row: ModuleContentRow
  element: ModuleContentElement
}

export function sortedByOrder<T extends { order: number }>(list: readonly T[] | undefined): T[] {
  return [...(list || [])].sort((a, b) => a.order - b.order)
}

export function sortedByColumn<T extends { columnIndex: number }>(list: readonly T[] | undefined): T[] {
  return [...(list || [])].sort((a, b) => a.columnIndex - b.columnIndex)
}

export function reindexOrder<T extends { order: number }>(list: readonly T[]): T[] {
  return list.map((item, index) => ({ ...item, order: index }))
}

export function findElement(data: ResumeData, elementId: string): ElementLocation | null {
  const id = normalizeResumeTargetId(elementId)
  if (!id) return null
  for (const resumeModule of data.modules || []) {
    for (const row of resumeModule.rows || []) {
      const element = row.elements?.find((item) => item.id === id)
      if (element) return { module: resumeModule, row, element }
    }
  }
  return null
}

export function findModule(data: ResumeData, moduleId: string): ResumeModule | null {
  const id = normalizeResumeTargetId(moduleId)
  if (!id) return null
  return (data.modules || []).find((resumeModule) => resumeModule.id === id) || null
}

export function findRow(
  data: ResumeData,
  rowId: string,
): { module: ResumeModule; row: ModuleContentRow } | null {
  const id = normalizeResumeTargetId(rowId)
  if (!id) return null
  for (const resumeModule of data.modules || []) {
    const row = resumeModule.rows?.find((item) => item.id === id)
    if (row) return { module: resumeModule, row }
  }
  return null
}

export function withUpdatedElement(
  data: ResumeData,
  elementId: string,
  updater: (element: ModuleContentElement) => ModuleContentElement,
): ResumeData {
  const id = normalizeResumeTargetId(elementId)
  return {
    ...data,
    modules: (data.modules || []).map((module) => ({
      ...module,
      rows: (module.rows || []).map((row) => ({
        ...row,
        elements: (row.elements || []).map((element) => (element.id === id ? updater(element) : element)),
      })),
    })),
  }
}

export function withUpdatedModule(
  data: ResumeData,
  moduleId: string,
  updater: (module: ResumeModule) => ResumeModule,
): ResumeData {
  const id = normalizeResumeTargetId(moduleId)
  return {
    ...data,
    modules: (data.modules || []).map((module) => (module.id === id ? updater(module) : module)),
  }
}
