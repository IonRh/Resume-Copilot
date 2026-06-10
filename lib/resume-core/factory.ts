import type {
  JobIntentionItem,
  JSONContent,
  ModuleContentElement,
  ModuleContentRow,
  PersonalInfoItem,
  ResumeData,
  ResumeModule,
} from "@/types/resume"
import { createElementId, createModuleId, createResumeId, createRowId, genId } from "./id"
import {
  type ColumnFormat,
  getFirstTextFormat,
  textToDoc,
  textToStyledDoc,
} from "./document"

export type ResumeColumnCount = 1 | 2 | 3 | 4
export type PersonalInfoItemsPerRow = 1 | 2 | 3 | 4 | 5 | 6

export interface ResumeRowSpec {
  type?: "rich" | "tags"
  columns?: number
  texts?: string[]
  tags?: string[]
  formats?: ColumnFormat[]
}

type Args = Record<string, unknown>

const PHONE_ICON =
  '<path fill="currentColor" d="M6.62 10.79c1.44 2.83 3.76 5.15 6.59 6.59l2.2-2.2c.28-.28.67-.36 1.02-.25c1.12.37 2.32.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57c.11.35.03.74-.25 1.02z"/>'
const EMAIL_ICON =
  '<path fill="currentColor" d="m20 8l-8 5l-8-5V6l8 5l8-5m0-2H4c-1.11 0-2 .89-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2"/>'
const EDUCATION_ICON =
  '<path fill="currentColor" d="M12 3L1 9l11 6l9-4.91V17h2V9M5 13.18v4L12 21l7-3.82v-4L12 17z"/>'
const WORK_ICON =
  '<path fill="currentColor" d="M10 2h4a2 2 0 0 1 2 2v2h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8c0-1.11.89-2 2-2h4V4c0-1.11.89-2 2-2m4 4V4h-4v2z"/>'
export const GENERIC_MODULE_ICON =
  '<path fill="currentColor" d="M3 3h18v2H3zm0 4h18v2H3zm0 4h12v2H3zm0 4h18v2H3zm0 4h12v2H3z"/>'

const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback)
const bool = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined)
const int = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined

export function clampColumns(value: unknown, fallback: ResumeColumnCount = 1): ResumeColumnCount {
  const next = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(4, Math.max(1, next)) as ResumeColumnCount
}

export function clampPersonalInfoItemsPerRow(
  value: unknown,
  fallback: PersonalInfoItemsPerRow = 2,
): PersonalInfoItemsPerRow {
  const next = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(6, Math.max(1, next)) as PersonalInfoItemsPerRow
}

export function normalizeColumnFormats(raw: unknown): ColumnFormat[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const value = (item || {}) as Args
    return {
      bold: bool(value.bold),
      fontSize: str(value.fontSize) || undefined,
      fontFamily: str(value.fontFamily) || undefined,
      textAlign: str(value.textAlign) || undefined,
    }
  })
}

export function rowSpecFromArgs(raw: Args): ResumeRowSpec {
  return {
    type: str(raw.type) === "tags" ? "tags" : "rich",
    columns: int(raw.columns),
    texts: Array.isArray(raw.texts) ? raw.texts.map(String) : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : undefined,
    formats: normalizeColumnFormats(raw.formats),
  }
}

function defaultColumnAlign(columns: number, index: number): string {
  if (columns === 3) return ["left", "center", "right"][index] || "left"
  return "left"
}

export function createRichRow(options: {
  id?: string
  order: number
  columns: ResumeColumnCount
  texts?: string[]
  formats?: ColumnFormat[]
  elementIds?: string[]
  inherit?: ModuleContentRow | null
}): ModuleContentRow {
  const elements: ModuleContentElement[] = []
  for (let index = 0; index < options.columns; index++) {
    const inherited =
      options.inherit?.columns === options.columns && options.inherit.elements[index]
        ? getFirstTextFormat(options.inherit.elements[index].content)
        : undefined
    const explicit = options.formats?.[index]
    const format: ColumnFormat = {
      ...inherited,
      ...explicit,
      textAlign: explicit?.textAlign ?? inherited?.textAlign ?? defaultColumnAlign(options.columns, index),
      bold: explicit?.bold ?? inherited?.bold ?? (index === 0 && options.columns >= 2 ? true : undefined),
    }
    elements.push({
      id: options.elementIds?.[index] || createElementId(),
      content: textToStyledDoc(options.texts?.[index] ?? "", format),
      columnIndex: index,
    })
  }
  return {
    id: options.id || createRowId(),
    type: "rich",
    columns: options.columns,
    elements,
    order: options.order,
  }
}

export function createEmptyResumeRow(columns: ResumeColumnCount, order: number): ModuleContentRow {
  const elements: ModuleContentElement[] = []
  for (let index = 0; index < columns; index++) {
    elements.push({
      id: createElementId(),
      content: textToDoc(""),
      columnIndex: index,
    })
  }
  return {
    id: createRowId(),
    type: "rich",
    columns,
    elements,
    order,
  }
}

export function createTagsRow(order: number, tags: string[] = [], id?: string): ModuleContentRow {
  return {
    id: id || createRowId(),
    type: "tags",
    columns: 1,
    elements: [],
    tags,
    order,
  }
}

export function createResumeRowFromSpec(
  spec: ResumeRowSpec,
  order: number,
  inherit?: ModuleContentRow | null,
): ModuleContentRow {
  if (spec.type === "tags") {
    return createTagsRow(order, Array.isArray(spec.tags) ? spec.tags.map(String) : [])
  }
  const texts = Array.isArray(spec.texts) ? spec.texts.map(String) : []
  const columns = clampColumns(spec.columns || texts.length || 1)
  return createRichRow({ order, columns, texts, formats: spec.formats, inherit })
}

export function createNewModule(order: number): ResumeModule {
  return {
    id: createModuleId(),
    title: "新模块",
    icon: undefined,
    order,
    rows: [],
  }
}

export function createResumeModuleFromSpec(
  title: string,
  rows: ResumeRowSpec[] | undefined,
  order: number,
  options: { id?: string; icon?: string } = {},
): ResumeModule {
  const builtRows: ModuleContentRow[] = []
  ;(rows || []).forEach((row, index) => {
    builtRows.push(createResumeRowFromSpec(row, index, builtRows[index - 1]))
  })
  return {
    id: options.id || createModuleId(),
    title: title || "新模块",
    icon: options.icon ?? GENERIC_MODULE_ICON,
    order,
    rows: builtRows,
  }
}

export function createNewPersonalInfoItem(): PersonalInfoItem {
  return {
    id: createResumeId("info"),
    label: "新标签，如：电话、邮箱等",
    value: {
      content: "",
      type: "text",
    },
    icon: "mdi:information",
    order: 0,
  }
}

export function createNewJobIntentionItem(
  type: "workYears" | "position" | "city" | "salary" | "custom",
  order: number,
): JobIntentionItem {
  const labels = {
    workYears: "工作经验",
    position: "求职意向",
    city: "目标城市",
    salary: "期望薪资",
    custom: "自定义",
  }

  return {
    id: createResumeId("jii"),
    label: labels[type],
    value: "",
    order,
    type,
    salaryRange: type === "salary" ? { min: undefined, max: undefined } : undefined,
  }
}

export function buildPersonalInfoItems(raw: unknown): PersonalInfoItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item, index) => {
    const value = (item || {}) as Args
    const type = str(value.type) === "link" ? "link" : "text"
    return {
      id: genId("info"),
      label: str(value.label),
      value: {
        content: str(value.content),
        type,
        ...(type === "link" && value.linkTitle ? { title: str(value.linkTitle) } : {}),
      },
      icon: "mdi:information",
      order: index,
    }
  })
}

export function buildJobIntentionItems(raw: unknown): JobIntentionItem[] {
  if (!Array.isArray(raw)) return []
  const allowed = ["workYears", "position", "city", "salary", "custom"]
  return raw.map((item, index) => {
    const value = (item || {}) as Args
    const type = (allowed.includes(str(value.type)) ? str(value.type) : "custom") as JobIntentionItem["type"]
    const salaryRange = value.salaryRange && typeof value.salaryRange === "object"
      ? (value.salaryRange as JobIntentionItem["salaryRange"])
      : undefined
    return {
      id: genId("jii"),
      label: str(value.label),
      value: str(value.value),
      order: index,
      type,
      salaryRange: type === "salary" ? salaryRange : undefined,
    }
  })
}

export function draftToResumeData(draft: Args, base: ResumeData): ResumeData {
  const personalInfo = buildPersonalInfoItems(draft.personalInfo)
  const jobIntention = (draft.jobIntention || {}) as Args
  const now = new Date().toISOString()
  return {
    title: str(draft.title, "我的简历"),
    parentResumeId: base.parentResumeId,
    parentResumeTitle: base.parentResumeTitle,
    resumeKind: base.resumeKind,
    variantLabel: base.variantLabel,
    buildMode: base.buildMode,
    creationMode: base.creationMode,
    centerTitle: bool(draft.centerTitle) ?? true,
    themeColor: str(draft.themeColor) || base.themeColor,
    personalInfoSection: {
      personalInfo,
      showPersonalInfoLabels: base.personalInfoSection?.showPersonalInfoLabels ?? false,
      avatarShape: base.personalInfoSection?.avatarShape ?? "circle",
      avatarType: base.personalInfoSection?.avatarType ?? "default",
      layout: base.personalInfoSection?.layout ?? { mode: "grid", itemsPerRow: 2 },
    },
    jobIntentionSection: {
      enabled: bool(jobIntention.enabled) ?? true,
      items: buildJobIntentionItems(jobIntention.items),
    },
    modules: (Array.isArray(draft.modules) ? draft.modules : []).map((module, index) => {
      const value = (module || {}) as Args
      const rows = Array.isArray(value.rows)
        ? value.rows.map((row) => rowSpecFromArgs((row || {}) as Args))
        : undefined
      return createResumeModuleFromSpec(str(value.title), rows, index)
    }),
    avatar: base.avatar,
    createdAt: base.createdAt || now,
    updatedAt: now,
  }
}

export function createDefaultResumeData(): ResumeData {
  const now = new Date().toISOString()

  return {
    title: "我的简历",
    centerTitle: true,
    personalInfoSection: {
      personalInfo: [
        {
          id: "phone",
          label: "电话",
          value: {
            content: "138xxxx8888",
            type: "text",
          },
          icon: PHONE_ICON,
          order: 0,
        },
        {
          id: "email",
          label: "邮箱",
          value: {
            content: "example@email.com",
            type: "text",
          },
          icon: EMAIL_ICON,
          order: 1,
        },
      ],
      showPersonalInfoLabels: false,
      avatarShape: "circle",
      avatarType: "default",
      layout: {
        mode: "grid",
        itemsPerRow: 2,
      },
    },
    jobIntentionSection: {
      items: [
        {
          id: "jii-1",
          label: "工作经验",
          value: "3年",
          order: 0,
          type: "workYears",
        },
        {
          id: "jii-2",
          label: "求职意向",
          value: "前端工程师",
          order: 1,
          type: "position",
        },
      ],
      enabled: true,
    },
    modules: [
      createResumeModuleFromSpec(
        "教育背景",
        [
          {
            columns: 3,
            texts: ["XX大学", "计算机科学与技术", "2018.09 - 2022.06"],
            formats: [
              { textAlign: "left", bold: false },
              { textAlign: "center", bold: false },
              { textAlign: "right", bold: false },
            ],
          },
        ],
        0,
        { icon: EDUCATION_ICON },
      ),
      createResumeModuleFromSpec(
        "工作经历",
        [
          {
            columns: 3,
            texts: ["XX科技公司", "前端工程师", "2022.07 - 至今"],
            formats: [
              { textAlign: "left", bold: false },
              { textAlign: "center", bold: false },
              { textAlign: "right", bold: false },
            ],
          },
          {
            columns: 1,
            texts: ["负责公司核心产品的前端开发工作，使用 React、TypeScript 等技术栈。"],
            formats: [{ textAlign: "left", bold: false }],
          },
        ],
        1,
        { icon: WORK_ICON },
      ),
    ],
    avatar: "/default-avatar.jpg",
    createdAt: now,
    updatedAt: now,
  }
}

export function ensureDoc(value: unknown): JSONContent {
  if (value && typeof value === "object") return value as JSONContent
  return textToDoc("")
}
