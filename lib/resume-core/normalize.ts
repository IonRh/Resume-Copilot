import type {
  JobIntentionItem,
  ModuleContentElement,
  ModuleContentRow,
  PersonalInfoItem,
  PersonalInfoSection,
  ResumeData,
  ResumeModule,
} from "@/types/resume"
import {
  clampColumns,
  clampPersonalInfoItemsPerRow,
  ensureDoc,
} from "./factory"
import { reindexOrder } from "./operations"

interface NormalizeOptions {
  createdAt?: string
  updatedAt?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value))

const textValue = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : value == null ? fallback : String(value)

function orderValue(value: unknown): number {
  return isRecord(value) && typeof value.order === "number" && Number.isFinite(value.order)
    ? value.order
    : Number.MAX_SAFE_INTEGER
}

function columnValue(value: unknown): number {
  return isRecord(value) && typeof value.columnIndex === "number" && Number.isFinite(value.columnIndex)
    ? value.columnIndex
    : Number.MAX_SAFE_INTEGER
}

function sortByOrderValue<T>(items: T[]): T[] {
  return [...items].sort((a, b) => orderValue(a) - orderValue(b))
}

function normalizePersonalItem(item: unknown, index: number): PersonalInfoItem {
  const source = isRecord(item) ? item : {}
  const value = isRecord(source.value) ? source.value : {}
  const type = value.type === "link" ? "link" : "text"
  return {
    ...(source as Partial<PersonalInfoItem>),
    id: textValue(source.id, `info-${index}`) || `info-${index}`,
    label: textValue(source.label),
    value: {
      content: textValue(value.content),
      type,
      ...(type === "link" && typeof value.title === "string" ? { title: value.title } : {}),
    },
    order: index,
  }
}

function normalizePersonalInfoSection(section: unknown): PersonalInfoSection {
  const source = isRecord(section) ? section : {}
  const layout = isRecord(source.layout) ? source.layout : {}
  const personalInfo = Array.isArray(source.personalInfo)
    ? reindexOrder(sortByOrderValue(source.personalInfo).map(normalizePersonalItem))
    : []
  const mode = layout.mode === "inline" ? "inline" : "grid"
  return {
    personalInfo,
    showPersonalInfoLabels:
      typeof source.showPersonalInfoLabels === "boolean" ? source.showPersonalInfoLabels : false,
    avatarShape: source.avatarShape === "square" ? "square" : "circle",
    avatarType: source.avatarType === "idPhoto" ? "idPhoto" : "default",
    layout: {
      mode,
      itemsPerRow: clampPersonalInfoItemsPerRow(layout.itemsPerRow, 2),
    },
  }
}

function normalizeJobItem(item: unknown, index: number): JobIntentionItem {
  const source = isRecord(item) ? item : {}
  const allowed = ["workYears", "position", "city", "salary", "custom"]
  const type = allowed.includes(textValue(source.type))
    ? (source.type as JobIntentionItem["type"])
    : "custom"
  return {
    ...(source as Partial<JobIntentionItem>),
    id: textValue(source.id, `jii-${index}`) || `jii-${index}`,
    label: textValue(source.label),
    value: textValue(source.value),
    order: index,
    type,
    salaryRange: type === "salary" && isRecord(source.salaryRange) ? source.salaryRange : undefined,
  }
}

function normalizeElements(rowId: string, columns: ModuleContentRow["columns"], rawElements: unknown): ModuleContentElement[] {
  const existing = Array.isArray(rawElements)
    ? [...rawElements].sort((a, b) => columnValue(a) - columnValue(b)).slice(0, columns)
    : []
  const elements: ModuleContentElement[] = []
  for (let index = 0; index < columns; index++) {
    const element = isRecord(existing[index]) ? existing[index] : {}
    elements.push({
      id: textValue(element.id, `${rowId || "row"}-el-${index}`) || `${rowId || "row"}-el-${index}`,
      content: ensureDoc(element.content),
      columnIndex: index,
    })
  }
  return elements
}

function normalizeRow(row: unknown, index: number): ModuleContentRow {
  const source = isRecord(row) ? row : {}
  const id = textValue(source.id, `row-${index}`) || `row-${index}`
  if (source.type === "tags") {
    return {
      ...(source as Partial<ModuleContentRow>),
      id,
      type: "tags",
      columns: 1,
      elements: [],
      tags: Array.isArray(source.tags) ? source.tags.map(String) : [],
      order: index,
    }
  }
  const columns = clampColumns(source.columns, 1)
  const richRow: ModuleContentRow = {
    ...(source as Partial<ModuleContentRow>),
    id,
    type: "rich",
    columns,
    elements: [],
    order: index,
  }
  return {
    ...richRow,
    elements: normalizeElements(id, columns, source.elements),
  }
}

function normalizeModule(module: unknown, index: number): ResumeModule {
  const source = isRecord(module) ? module : {}
  const rows = Array.isArray(source.rows)
    ? reindexOrder(sortByOrderValue(source.rows).map(normalizeRow))
    : []
  return {
    ...(source as Partial<ResumeModule>),
    id: textValue(source.id, `module-${index}`) || `module-${index}`,
    title: textValue(source.title),
    order: index,
    rows,
  }
}

export function normalizeResumeData(data: ResumeData, options: NormalizeOptions = {}): ResumeData {
  const source: Record<string, unknown> = isRecord(data) ? data : {}
  const jobIntentionSection = isRecord(source.jobIntentionSection) ? source.jobIntentionSection : undefined
  const now = new Date().toISOString()
  const createdAt = textValue(source.createdAt, options.createdAt || now)
  const updatedAt = options.updatedAt || textValue(source.updatedAt, now)
  const modules = Array.isArray(source.modules)
    ? reindexOrder(sortByOrderValue(source.modules).map(normalizeModule))
    : []
  return {
    ...(source as Partial<ResumeData>),
    title: textValue(source.title),
    centerTitle: typeof source.centerTitle === "boolean" ? source.centerTitle : true,
    personalInfoSection: normalizePersonalInfoSection(source.personalInfoSection),
    jobIntentionSection: jobIntentionSection
      ? {
        enabled: typeof jobIntentionSection.enabled === "boolean" ? jobIntentionSection.enabled : true,
        items: Array.isArray(jobIntentionSection.items)
          ? reindexOrder(sortByOrderValue(jobIntentionSection.items).map(normalizeJobItem))
          : [],
      }
      : undefined,
    modules,
    createdAt,
    updatedAt,
  } as ResumeData
}

export function validateResumeData(data: ResumeData): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!data.title?.trim()) {
    errors.push("简历标题不能为空")
  }

  if (!data.personalInfoSection || !Array.isArray(data.personalInfoSection.personalInfo)) {
    errors.push("个人信息格式错误")
  } else {
    data.personalInfoSection.personalInfo.forEach((item, index) => {
      if (!item.id || !item.label?.trim() || !item.value || typeof item.value.content !== "string") {
        errors.push(`个人信息第${index + 1}项格式错误`)
      }
    })
  }

  const layout = data.personalInfoSection?.layout
  if (layout && layout.mode !== "inline" && layout.mode !== "grid") {
    errors.push("个人信息布局模式错误")
  }
  if (layout?.itemsPerRow !== undefined && (layout.itemsPerRow < 1 || layout.itemsPerRow > 6)) {
    errors.push("个人信息每行数量错误")
  }

  if (!Array.isArray(data.modules)) {
    errors.push("简历模块格式错误")
  } else {
    data.modules.forEach((module, moduleIndex) => {
      if (!module.id || typeof module.title !== "string" || !Array.isArray(module.rows)) {
        errors.push(`简历模块第${moduleIndex + 1}项格式错误`)
        return
      }
      module.rows.forEach((row, rowIndex) => {
        if (!row.id || row.columns < 1 || row.columns > 4) {
          errors.push(`简历模块第${moduleIndex + 1}项第${rowIndex + 1}行格式错误`)
        }
        if (row.type === "tags") {
          if (!Array.isArray(row.tags)) errors.push(`简历模块第${moduleIndex + 1}项第${rowIndex + 1}行标签格式错误`)
          return
        }
        if (!Array.isArray(row.elements) || row.elements.length !== row.columns) {
          errors.push(`简历模块第${moduleIndex + 1}项第${rowIndex + 1}行元素格式错误`)
        }
      })
    })
  }

  if (
    data.personalInfoSection?.showPersonalInfoLabels !== undefined &&
    typeof data.personalInfoSection.showPersonalInfoLabels !== "boolean"
  ) {
    errors.push("显示个人信息标签设置格式错误")
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}
