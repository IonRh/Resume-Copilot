import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import type { ResumeData, StoredResume } from "@/types/resume"
import { normalizeResumeData as normalizeResumeCoreData, validateResumeData } from "@/lib/resume-core"

const DATA_DIR = path.join(process.cwd(), "data")
const RESUME_STORE_PATH = path.join(DATA_DIR, "resumes.json")
const TEMPLATE_DIR = path.join(DATA_DIR, "templates")

type StoredResumeFile = {
  version: 1
  resumes: StoredResume[]
}

function cloneResume<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 进程内写锁：将所有“读-改-写”串行化，避免并发请求互相覆盖、写坏文件
let writeChain: Promise<unknown> = Promise.resolve()
function withLock<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task)
  writeChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function normalizeResumeData(data: ResumeData, createdAt: string, updatedAt: string): ResumeData {
  const normalized = normalizeResumeCoreData(data, { createdAt, updatedAt })
  const { isValid, errors } = validateResumeData(normalized)
  if (!isValid) {
    throw new Error(`简历数据校验失败：${errors.join("；")}`)
  }
  return normalized
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true })
}

function parseStore(raw: string): StoredResumeFile | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredResumeFile> | StoredResume[]
    if (Array.isArray(parsed)) return { version: 1, resumes: parsed }
    if (parsed && Array.isArray(parsed.resumes)) return { version: 1, resumes: parsed.resumes }
  } catch {
    return null
  }
  return null
}

async function readStore(): Promise<StoredResumeFile> {
  await ensureDataDir()
  let raw: string
  try {
    raw = await readFile(RESUME_STORE_PATH, "utf-8")
  } catch (error: unknown) {
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined
    if (code === "ENOENT") return { version: 1, resumes: [] }
    throw error
  }

  const parsed = parseStore(raw)
  if (parsed) return parsed

  // 文件损坏时，尝试从最近一次备份恢复
  try {
    const backup = await readFile(`${RESUME_STORE_PATH}.bak`, "utf-8")
    const recovered = parseStore(backup)
    if (recovered) return recovered
  } catch {
    /* 没有可用备份则继续 */
  }
  throw new Error("简历文件已损坏，且无可用备份")
}

async function writeStore(store: StoredResumeFile) {
  await ensureDataDir()
  const payload = `${JSON.stringify(store, null, 2)}\n`
  // 唯一临时文件名，避免并发写入相互覆盖产生半截内容
  const tmp = `${RESUME_STORE_PATH}.${process.pid}.${randomUUID()}.tmp`
  // 写入前留存上一份内容作为备份
  try {
    const previous = await readFile(RESUME_STORE_PATH, "utf-8")
    if (parseStore(previous)) await writeFile(`${RESUME_STORE_PATH}.bak`, previous, "utf-8")
  } catch {
    /* 首次写入或读失败时跳过备份 */
  }
  await writeFile(tmp, payload, "utf-8")
  await rename(tmp, RESUME_STORE_PATH)
}

export async function listResumes(): Promise<StoredResume[]> {
  const store = await readStore()
  return cloneResume(store.resumes)
}

export async function getResume(id: string): Promise<StoredResume | null> {
  const store = await readStore()
  const entry = store.resumes.find((item) => item.id === id)
  return entry ? cloneResume(entry) : null
}

export function createResume(data: ResumeData): Promise<StoredResume> {
  return withLock(async () => {
    const store = await readStore()
    const now = new Date().toISOString()
    const entry: StoredResume = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      resumeData: normalizeResumeData(data, now, now),
    }
    store.resumes.unshift(entry)
    await writeStore(store)
    return cloneResume(entry)
  })
}

export function updateResume(id: string, data: ResumeData): Promise<StoredResume> {
  return withLock(async () => {
    const store = await readStore()
    const index = store.resumes.findIndex((item) => item.id === id)
    if (index < 0) {
      throw new Error("未找到对应的简历条目")
    }
    const now = new Date().toISOString()
    const previous = store.resumes[index]
    const updated: StoredResume = {
      ...previous,
      updatedAt: now,
      resumeData: normalizeResumeData(data, previous.resumeData.createdAt || previous.createdAt, now),
    }
    store.resumes[index] = updated
    await writeStore(store)
    return cloneResume(updated)
  })
}

export function deleteResumeIds(ids: string[]): Promise<number> {
  return withLock(async () => {
    const store = await readStore()
    const idSet = new Set(ids)
    const before = store.resumes.length
    store.resumes = store.resumes.filter((item) => !idSet.has(item.id))
    const deleted = before - store.resumes.length
    if (deleted > 0) {
      await writeStore(store)
    }
    return deleted
  })
}

export async function loadTemplate(type: "default" | "example"): Promise<ResumeData> {
  const filename = type === "example" ? "example.json" : "template.json"
  const raw = await readFile(path.join(TEMPLATE_DIR, filename), "utf-8")
  const parsed = JSON.parse(raw) as { data?: ResumeData }
  if (!parsed.data) {
    throw new Error("模板文件缺少简历数据")
  }
  const now = new Date().toISOString()
  return normalizeResumeData(parsed.data, parsed.data.createdAt || now, now)
}
