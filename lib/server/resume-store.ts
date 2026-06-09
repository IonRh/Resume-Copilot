import { randomUUID } from "node:crypto"
import { mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import type { ResumeData, StoredResume } from "@/types/resume"
import { sanitizeResumeDisplayName } from "@/lib/resume-display"
import { normalizeResumeData as normalizeResumeCoreData, validateResumeData } from "@/lib/resume-core"
import { getCurrentUsername } from "@/lib/server/api-auth"

const DATA_DIR = path.join(process.cwd(), "data")
const LEGACY_RESUME_STORE_PATH = path.join(DATA_DIR, "resumes.json")
const SQLITE_STORE_PATH = path.join(DATA_DIR, "resumes.sqlite")
const TEMPLATE_DIR = path.join(DATA_DIR, "templates")
const LEGACY_MIGRATION_KEY = "legacy_json_migrated"

type StoredResumeFile = {
  version: 1
  resumes: StoredResume[]
}

type ResumeRow = {
  id: string
  owner: string
  display_name: string | null
  created_at: string
  updated_at: string
  resume_data: string
}

type CountRow = {
  count: number | bigint | null
}

type MetaRow = {
  value: string | null
}

// 进程内写锁：将所有“读-改-写”串行化，避免并发请求互相覆盖
let writeChain: Promise<unknown> = Promise.resolve()
let dbInstance: DatabaseSync | null = null
let dbInit: Promise<DatabaseSync> | null = null

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

function normalizeStoredResume(entry: StoredResume): StoredResume {
  const displayName = sanitizeResumeDisplayName(entry.displayName) || entry.resumeData.title || "未命名"
  return {
    ...entry,
    displayName,
  }
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true })
}

function parseLegacyStore(raw: string): StoredResumeFile | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredResumeFile> | StoredResume[]
    if (Array.isArray(parsed)) return { version: 1, resumes: parsed }
    if (parsed && Array.isArray(parsed.resumes)) return { version: 1, resumes: parsed.resumes }
  } catch {
    return null
  }
  return null
}

async function readLegacyStore(): Promise<StoredResumeFile | null> {
  let sawLegacyFile = false
  for (const filename of [LEGACY_RESUME_STORE_PATH, `${LEGACY_RESUME_STORE_PATH}.bak`]) {
    let raw: string
    try {
      raw = await readFile(filename, "utf-8")
      sawLegacyFile = true
    } catch (error: unknown) {
      const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined
      if (code === "ENOENT") continue
      throw error
    }

    const parsed = parseLegacyStore(raw)
    if (parsed) return parsed
  }

  if (sawLegacyFile) {
    throw new Error("旧版简历 JSON 已损坏，无法迁移到 SQLite")
  }
  return null
}

function configureDatabase(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
  `)
}

function ensureSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS resumes (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL DEFAULT 'admin',
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      position INTEGER NOT NULL,
      resume_data TEXT NOT NULL
    );

  `)
  try {
    db.exec("ALTER TABLE resumes ADD COLUMN owner TEXT NOT NULL DEFAULT 'admin'")
  } catch {
    /* column already exists */
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_resumes_owner_position ON resumes(owner, position, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_resumes_owner_updated_at ON resumes(owner, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_resumes_position ON resumes(position, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_resumes_updated_at ON resumes(updated_at DESC);
  `)
}

function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as MetaRow | undefined
  return typeof row?.value === "string" ? row.value : null
}

function setMeta(db: DatabaseSync, key: string, value: string) {
  db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

function resumeCount(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM resumes").get() as CountRow | undefined
  return Number(row?.count ?? 0)
}

function rowToStoredResume(row: ResumeRow): StoredResume {
  const resumeData = JSON.parse(row.resume_data) as ResumeData
  return normalizeStoredResume({
    id: row.id,
    displayName: row.display_name || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resumeData,
  })
}

function safeIso(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback
}

function legacyEntryToRow(entry: unknown, position: number): (Omit<ResumeRow, "owner"> & { position: number }) | null {
  if (!entry || typeof entry !== "object") return null

  const candidate = entry as Partial<StoredResume>
  if (!candidate.resumeData || typeof candidate.resumeData !== "object") return null

  const now = new Date().toISOString()
  const resumeData = candidate.resumeData as ResumeData
  const createdAt = safeIso(candidate.createdAt, safeIso(resumeData.createdAt, now))
  const updatedAt = safeIso(candidate.updatedAt, safeIso(resumeData.updatedAt, createdAt))
  const id = safeIso(candidate.id, randomUUID())
  const displayName = sanitizeResumeDisplayName(candidate.displayName) || resumeData.title || "未命名"

  return {
    id,
    display_name: displayName,
    created_at: createdAt,
    updated_at: updatedAt,
    position,
    resume_data: JSON.stringify(resumeData),
  }
}

async function migrateLegacyJsonIfNeeded(db: DatabaseSync) {
  if (getMeta(db, LEGACY_MIGRATION_KEY) === "1") return
  if (resumeCount(db) > 0) {
    setMeta(db, LEGACY_MIGRATION_KEY, "1")
    return
  }

  const legacy = await readLegacyStore()
  if (!legacy || legacy.resumes.length === 0) {
    setMeta(db, LEGACY_MIGRATION_KEY, "1")
    return
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO resumes (
      id,
      owner,
      display_name,
      created_at,
      updated_at,
      position,
      resume_data
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  db.exec("BEGIN IMMEDIATE")
  try {
    legacy.resumes.forEach((entry, index) => {
      const row = legacyEntryToRow(entry, index)
      if (!row) return
      insert.run(row.id, "admin", row.display_name, row.created_at, row.updated_at, row.position, row.resume_data)
    })
    setMeta(db, LEGACY_MIGRATION_KEY, "1")
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

async function initDatabase(): Promise<DatabaseSync> {
  await ensureDataDir()
  const db = new DatabaseSync(SQLITE_STORE_PATH, { timeout: 5000 })
  try {
    configureDatabase(db)
    ensureSchema(db)
    await migrateLegacyJsonIfNeeded(db)
    dbInstance = db
    return db
  } catch (error) {
    db.close()
    dbInit = null
    throw error
  }
}

async function getDb(): Promise<DatabaseSync> {
  if (dbInstance) return dbInstance
  dbInit ??= initDatabase()
  return dbInit
}

function newEntryPosition(): number {
  return -Date.now()
}

export async function listResumes(): Promise<StoredResume[]> {
  const owner = await getCurrentUsername()
  const db = await getDb()
  const rows = db.prepare(`
    SELECT id, display_name, created_at, updated_at, resume_data
    FROM resumes
    WHERE owner = ?
    ORDER BY position ASC, created_at DESC
  `).all(owner) as ResumeRow[]
  return rows.map(rowToStoredResume)
}

export async function getResume(id: string): Promise<StoredResume | null> {
  const owner = await getCurrentUsername()
  const db = await getDb()
  const row = db.prepare(`
    SELECT id, display_name, created_at, updated_at, resume_data
    FROM resumes
    WHERE id = ? AND owner = ?
  `).get(id, owner) as ResumeRow | undefined
  return row ? rowToStoredResume(row) : null
}

export function createResume(data: ResumeData, displayName?: string): Promise<StoredResume> {
  return withLock(async () => {
    const db = await getDb()
    const owner = await getCurrentUsername()
    const now = new Date().toISOString()
    const resumeData = normalizeResumeData(data, now, now)
    const entry = normalizeStoredResume({
      id: randomUUID(),
      displayName: sanitizeResumeDisplayName(displayName) || resumeData.title || "未命名",
      createdAt: now,
      updatedAt: now,
      resumeData,
    })

    db.prepare(`
      INSERT INTO resumes (
        id,
        owner,
        display_name,
        created_at,
        updated_at,
        position,
        resume_data
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      owner,
      entry.displayName || "未命名",
      entry.createdAt,
      entry.updatedAt,
      newEntryPosition(),
      JSON.stringify(entry.resumeData),
    )

    return entry
  })
}

export function updateResume(id: string, data: ResumeData, displayName?: string): Promise<StoredResume> {
  return withLock(async () => {
    const db = await getDb()
    const previous = await getResume(id)
    if (!previous) {
      throw new Error("未找到对应的简历条目")
    }

    const now = new Date().toISOString()
    const resumeData = normalizeResumeData(data, previous.resumeData.createdAt || previous.createdAt, now)
    const updated = normalizeStoredResume({
      ...previous,
      displayName:
        sanitizeResumeDisplayName(displayName) ||
        sanitizeResumeDisplayName(previous.displayName) ||
        resumeData.title ||
        "未命名",
      updatedAt: now,
      resumeData,
    })

    db.prepare(`
      UPDATE resumes
      SET display_name = ?,
          updated_at = ?,
          resume_data = ?
      WHERE id = ? AND owner = ?
    `).run(updated.displayName || "未命名", updated.updatedAt, JSON.stringify(updated.resumeData), id, await getCurrentUsername())

    return updated
  })
}

export function updateResumeDisplayName(id: string, displayName: string): Promise<StoredResume> {
  return withLock(async () => {
    const db = await getDb()
    const previous = await getResume(id)
    if (!previous) {
      throw new Error("未找到对应的简历条目")
    }

    const nextName = sanitizeResumeDisplayName(displayName)
    if (!nextName) {
      throw new Error("简历名称不能为空")
    }

    const now = new Date().toISOString()
    const updated = normalizeStoredResume({
      ...previous,
      displayName: nextName,
      updatedAt: now,
    })

    db.prepare(`
      UPDATE resumes
      SET display_name = ?,
          updated_at = ?
      WHERE id = ? AND owner = ?
    `).run(updated.displayName || "未命名", updated.updatedAt, id, await getCurrentUsername())

    return updated
  })
}

export function deleteResumeIds(ids: string[]): Promise<number> {
  return withLock(async () => {
    if (ids.length === 0) return 0

    const db = await getDb()
    const owner = await getCurrentUsername()
    const placeholders = ids.map(() => "?").join(", ")
    const result = db.prepare(`DELETE FROM resumes WHERE owner = ? AND id IN (${placeholders})`).run(owner, ...ids)
    return Number(result.changes)
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
