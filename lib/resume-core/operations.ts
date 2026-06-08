import type {
  ModuleContentElement,
  ModuleContentRow,
  ResumeData,
  ResumeModule,
} from "@/types/resume"

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
  for (const resumeModule of data.modules || []) {
    for (const row of resumeModule.rows || []) {
      const element = row.elements?.find((item) => item.id === elementId)
      if (element) return { module: resumeModule, row, element }
    }
  }
  return null
}

export function findModule(data: ResumeData, moduleId: string): ResumeModule | null {
  return (data.modules || []).find((resumeModule) => resumeModule.id === moduleId) || null
}

export function findRow(
  data: ResumeData,
  rowId: string,
): { module: ResumeModule; row: ModuleContentRow } | null {
  for (const resumeModule of data.modules || []) {
    const row = resumeModule.rows?.find((item) => item.id === rowId)
    if (row) return { module: resumeModule, row }
  }
  return null
}

export function withUpdatedElement(
  data: ResumeData,
  elementId: string,
  updater: (element: ModuleContentElement) => ModuleContentElement,
): ResumeData {
  return {
    ...data,
    modules: (data.modules || []).map((module) => ({
      ...module,
      rows: (module.rows || []).map((row) => ({
        ...row,
        elements: (row.elements || []).map((element) => (element.id === elementId ? updater(element) : element)),
      })),
    })),
  }
}

export function withUpdatedModule(
  data: ResumeData,
  moduleId: string,
  updater: (module: ResumeModule) => ResumeModule,
): ResumeData {
  return {
    ...data,
    modules: (data.modules || []).map((module) => (module.id === moduleId ? updater(module) : module)),
  }
}
