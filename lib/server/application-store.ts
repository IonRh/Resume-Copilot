import { randomUUID } from "node:crypto"
import { mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import { getCurrentUsername } from "@/lib/server/api-auth"
import type {
  ApplicationEvent,
  ApplicationStatus,
  JobApplication,
} from "@/types/application"
import { APPLICATION_STATUS_FLOW, getStatusMeta } from "@/types/application"

const DATA_DIR = path.join(process.cwd(), "data")
const LEGACY_APPLICATION_STORE_PATH = path.join(DATA_DIR, "applications.json")
const SQLITE_STORE_PATH = path.join(DATA_DIR, "applications.sqlite")
const LEGACY_MIGRATION_KEY = "legacy_json_migrated"

const VALID_STATUSES = new Set<ApplicationStatus>(APPLICATION_STATUS_FLOW.map((item) => item.value))

type StoredApplicationFile = {
  version: 1
  applications: JobApplication[]
}

type ApplicationRow = {
  id: string
  owner: string
  updated_at: string
  application_json: string
}

type CountRow = {
  count: number | bigint | null
}

type MetaRow = {
  value: string | null
}

/** 创建/更新时允许客户端传入的字段 */
export type ApplicationInput = Partial<Omit<JobApplication, "id" | "createdAt" | "updatedAt" | "events">> & {
  events?: ApplicationEvent[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

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

    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL,
      company TEXT NOT NULL,
      position TEXT NOT NULL,
      application_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_applications_owner_updated_at ON applications(owner, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_applications_owner_status ON applications(owner, status, updated_at DESC);
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

function applicationCount(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM applications").get() as CountRow | undefined
  return Number(row?.count ?? 0)
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

async function readLegacyStore(): Promise<StoredApplicationFile | null> {
  let sawLegacyFile = false
  for (const filename of [LEGACY_APPLICATION_STORE_PATH, `${LEGACY_APPLICATION_STORE_PATH}.bak`]) {
    let raw: string
    try {
      raw = await readFile(filename, "utf-8")
      sawLegacyFile = true
    } catch (error: unknown) {
      const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined
      if (code === "ENOENT") continue
      throw error
    }

    const parsed = parseStore(raw)
    if (parsed) return parsed
  }

  if (sawLegacyFile) {
    throw new Error("旧版投递 JSON 已损坏，无法迁移到 SQLite")
  }
  return null
}

function safeIso(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback
}

function normalizeApplication(entry: JobApplication): JobApplication {
  const now = new Date().toISOString()
  const status = normalizeStatus(entry.status)
  return {
    ...entry,
    id: cleanString(entry.id) || randomUUID(),
    company: cleanString(entry.company) || "未命名公司",
    position: cleanString(entry.position) || "未填写岗位",
    status,
    priority: (typeof entry.priority === "string" && ["high", "normal", "low"].includes(entry.priority) ? entry.priority : "normal") as JobApplication["priority"],
    events: normalizeEvents(entry.events),
    createdAt: safeIso(entry.createdAt, now),
    updatedAt: safeIso(entry.updatedAt, safeIso(entry.createdAt, now)),
  }
}

async function migrateLegacyJsonIfNeeded(db: DatabaseSync) {
  if (getMeta(db, LEGACY_MIGRATION_KEY) === "1") return
  if (applicationCount(db) > 0) {
    setMeta(db, LEGACY_MIGRATION_KEY, "1")
    return
  }

  const legacy = await readLegacyStore()
  if (!legacy || legacy.applications.length === 0) {
    setMeta(db, LEGACY_MIGRATION_KEY, "1")
    return
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO applications (
      id,
      owner,
      created_at,
      updated_at,
      status,
      company,
      position,
      application_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  db.exec("BEGIN IMMEDIATE")
  try {
    legacy.applications.forEach((entry) => {
      const app = normalizeApplication(entry)
      insert.run(
        app.id,
        "admin",
        app.createdAt,
        app.updatedAt,
        app.status,
        app.company,
        app.position,
        JSON.stringify(app),
      )
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

function rowToApplication(row: ApplicationRow): JobApplication {
  return JSON.parse(row.application_json) as JobApplication
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

function upsertApplicationRow(db: DatabaseSync, owner: string, entry: JobApplication) {
  db.prepare(`
    INSERT INTO applications (
      id,
      owner,
      created_at,
      updated_at,
      status,
      company,
      position,
      application_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      status = excluded.status,
      company = excluded.company,
      position = excluded.position,
      application_json = excluded.application_json
      WHERE owner = excluded.owner
  `).run(
    entry.id,
    owner,
    entry.createdAt,
    entry.updatedAt,
    entry.status,
    entry.company,
    entry.position,
    JSON.stringify(entry),
  )
}

export async function listApplications(): Promise<JobApplication[]> {
  const owner = await getCurrentUsername()
  const db = await getDb()
  const rows = db.prepare(`
    SELECT id, owner, updated_at, application_json
    FROM applications
    WHERE owner = ?
    ORDER BY updated_at DESC
  `).all(owner) as ApplicationRow[]
  return clone(rows.map(rowToApplication))
}

export async function getApplication(id: string): Promise<JobApplication | null> {
  const owner = await getCurrentUsername()
  const db = await getDb()
  const row = db.prepare(`
    SELECT id, owner, updated_at, application_json
    FROM applications
    WHERE id = ? AND owner = ?
  `).get(id, owner) as ApplicationRow | undefined
  return row ? clone(rowToApplication(row)) : null
}

export function createApplication(input: ApplicationInput): Promise<JobApplication> {
  return withLock(async () => {
    const db = await getDb()
    const owner = await getCurrentUsername()
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
    upsertApplicationRow(db, owner, entry)
    return clone(entry)
  })
}

export function updateApplication(id: string, input: ApplicationInput): Promise<JobApplication> {
  return withLock(async () => {
    const owner = await getCurrentUsername()
    const db = await getDb()
    const previous = await getApplication(id)
    if (!previous) throw new Error("未找到对应的投递记录")
    const now = new Date().toISOString()

    let events = previous.events
    const nextStatus = normalizeStatus(input.status ?? previous.status)
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
    upsertApplicationRow(db, owner, updated)
    return clone(updated)
  })
}

export function deleteApplicationIds(ids: string[]): Promise<number> {
  return withLock(async () => {
    if (ids.length === 0) return 0
    const db = await getDb()
    const owner = await getCurrentUsername()
    const placeholders = ids.map(() => "?").join(", ")
    const result = db.prepare(`DELETE FROM applications WHERE owner = ? AND id IN (${placeholders})`).run(owner, ...ids)
    return Number(result.changes)
  })
}
