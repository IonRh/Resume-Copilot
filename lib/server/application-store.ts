import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import type {
  ApplicationEvent,
  ApplicationStatus,
  JobApplication,
} from "@/types/application"
import { APPLICATION_STATUS_FLOW, getStatusMeta } from "@/types/application"

const DATA_DIR = path.join(process.cwd(), "data")
const APPLICATION_STORE_PATH = path.join(DATA_DIR, "applications.json")

const VALID_STATUSES = new Set<ApplicationStatus>(APPLICATION_STATUS_FLOW.map((item) => item.value))

type StoredApplicationFile = {
  version: 1
  applications: JobApplication[]
}

/** 创建/更新时允许客户端传入的字段 */
export type ApplicationInput = Partial<Omit<JobApplication, "id" | "createdAt" | "updatedAt" | "events">> & {
  events?: ApplicationEvent[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 进程内写锁：将所有“读-改-写”串行化，避免并发请求互相覆盖、写坏文件
let writeChain: Promise<unknown> = Promise.resolve()
function withLock<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task)
  // 无论成功失败都让出锁，但不向后续任务传播异常
  writeChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeStatus(value: unknown): ApplicationStatus {
  return typeof value === "string" && VALID_STATUSES.has(value as ApplicationStatus)
    ? (value as ApplicationStatus)
    : "applied"
}

function normalizeEvents(value: unknown): ApplicationEvent[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: cleanString(item.id) || randomUUID(),
      date: cleanString(item.date) || new Date().toISOString(),
      type: (["status", "interview", "note"].includes(item.type as string) ? item.type : "note") as ApplicationEvent["type"],
      status: typeof item.status === "string" && VALID_STATUSES.has(item.status as ApplicationStatus)
        ? (item.status as ApplicationStatus)
        : undefined,
      title: cleanString(item.title) || "进度更新",
      note: cleanString(item.note),
    }))
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true })
}

function parseStore(raw: string): StoredApplicationFile | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredApplicationFile> | JobApplication[]
    if (Array.isArray(parsed)) return { version: 1, applications: parsed }
    if (parsed && Array.isArray(parsed.applications)) return { version: 1, applications: parsed.applications }
  } catch {
    return null
  }
  return null
}

async function readStore(): Promise<StoredApplicationFile> {
  await ensureDataDir()
  let raw: string
  try {
    raw = await readFile(APPLICATION_STORE_PATH, "utf-8")
  } catch (error: unknown) {
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined
    if (code === "ENOENT") return { version: 1, applications: [] }
    throw error
  }

  const parsed = parseStore(raw)
  if (parsed) return parsed

  // 文件损坏时，先尝试从最近一次的备份恢复，避免整张列表读不出来
  try {
    const backup = await readFile(`${APPLICATION_STORE_PATH}.bak`, "utf-8")
    const recovered = parseStore(backup)
    if (recovered) return recovered
  } catch {
    /* 没有可用备份则继续 */
  }
  throw new Error("投递记录文件已损坏，且无可用备份")
}

async function writeStore(store: StoredApplicationFile) {
  await ensureDataDir()
  const payload = `${JSON.stringify(store, null, 2)}\n`
  // 唯一临时文件名，避免并发写入相互覆盖产生半截内容
  const tmp = `${APPLICATION_STORE_PATH}.${process.pid}.${randomUUID()}.tmp`
  // 写入前留存上一份内容作为备份，便于损坏时恢复
  try {
    const previous = await readFile(APPLICATION_STORE_PATH, "utf-8")
    if (parseStore(previous)) await writeFile(`${APPLICATION_STORE_PATH}.bak`, previous, "utf-8")
  } catch {
    /* 首次写入或读失败时跳过备份 */
  }
  await writeFile(tmp, payload, "utf-8")
  await rename(tmp, APPLICATION_STORE_PATH)
}

function buildApplication(
  input: ApplicationInput,
  base: Pick<JobApplication, "id" | "createdAt"> & { events: ApplicationEvent[] },
  now: string,
): JobApplication {
  const status = normalizeStatus(input.status)
  const company = cleanString(input.company) || "未命名公司"
  const position = cleanString(input.position) || "未填写岗位"
  return {
    id: base.id,
    company,
    position,
    location: cleanString(input.location),
    salary: cleanString(input.salary),
    channel: cleanString(input.channel),
    contact: cleanString(input.contact),
    jdUrl: cleanString(input.jdUrl),
    jdText: cleanString(input.jdText),
    resumeId: cleanString(input.resumeId),
    resumeTitle: cleanString(input.resumeTitle),
    status,
    priority: (["high", "normal", "low"].includes(input.priority as string)
      ? input.priority
      : "normal") as JobApplication["priority"],
    appliedAt: cleanString(input.appliedAt),
    nextAction: cleanString(input.nextAction),
    nextActionAt: cleanString(input.nextActionAt),
    events: input.events ? normalizeEvents(input.events) : base.events,
    notes: cleanString(input.notes),
    createdAt: base.createdAt,
    updatedAt: now,
  }
}

export async function listApplications(): Promise<JobApplication[]> {
  const store = await readStore()
  return clone(store.applications)
}

export async function getApplication(id: string): Promise<JobApplication | null> {
  const store = await readStore()
  const entry = store.applications.find((item) => item.id === id)
  return entry ? clone(entry) : null
}

export function createApplication(input: ApplicationInput): Promise<JobApplication> {
  return withLock(async () => {
    const store = await readStore()
    const now = new Date().toISOString()
    const status = normalizeStatus(input.status)
    const initialEvents = input.events
      ? normalizeEvents(input.events)
      : [
          {
            id: randomUUID(),
            date: now,
            type: "status" as const,
            status,
            title: `创建投递 · ${getStatusMeta(status).label}`,
          },
        ]
    const entry = buildApplication(input, { id: randomUUID(), createdAt: now, events: initialEvents }, now)
    store.applications.unshift(entry)
    await writeStore(store)
    return clone(entry)
  })
}

export function updateApplication(id: string, input: ApplicationInput): Promise<JobApplication> {
  return withLock(async () => {
    const store = await readStore()
    const index = store.applications.findIndex((item) => item.id === id)
    if (index < 0) throw new Error("未找到对应的投递记录")
    const now = new Date().toISOString()
    const previous = store.applications[index]

    let events = previous.events
    const nextStatus = normalizeStatus(input.status ?? previous.status)
    // 阶段发生变化时自动写入一条时间线事件
    if (!input.events && nextStatus !== previous.status) {
      events = [
        ...previous.events,
        {
          id: randomUUID(),
          date: now,
          type: "status",
          status: nextStatus,
          title: `推进到 · ${getStatusMeta(nextStatus).label}`,
        },
      ]
    }

    const merged: ApplicationInput = {
      ...previous,
      ...input,
      status: nextStatus,
      events: input.events ? normalizeEvents(input.events) : events,
    }
    const updated = buildApplication(merged, { id: previous.id, createdAt: previous.createdAt, events: merged.events ?? events }, now)
    store.applications[index] = updated
    await writeStore(store)
    return clone(updated)
  })
}

export function deleteApplicationIds(ids: string[]): Promise<number> {
  return withLock(async () => {
    const store = await readStore()
    const idSet = new Set(ids)
    const before = store.applications.length
    store.applications = store.applications.filter((item) => !idSet.has(item.id))
    const deleted = before - store.applications.length
    if (deleted > 0) await writeStore(store)
    return deleted
  })
}
