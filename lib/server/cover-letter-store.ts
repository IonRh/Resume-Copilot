import { mkdir } from "node:fs/promises"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import type { CoverLetterRecord } from "@/types/cover-letter"

const DATA_DIR = path.join(process.cwd(), "data")
const SQLITE_STORE_PATH = path.join(DATA_DIR, "cover-letters.sqlite")

type SessionRow = {
  id: string
  updated_at: string
  record_json: string
}

let dbInstance: DatabaseSync | null = null
let dbInit: Promise<DatabaseSync> | null = null
let writeChain: Promise<unknown> = Promise.resolve()

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task)
  writeChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
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
    CREATE TABLE IF NOT EXISTS cover_letters (
      id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL,
      record_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cover_letters_updated_at ON cover_letters(updated_at DESC);
  `)
}

async function initDatabase(): Promise<DatabaseSync> {
  await ensureDataDir()
  const db = new DatabaseSync(SQLITE_STORE_PATH, { timeout: 5000 })
  try {
    configureDatabase(db)
    ensureSchema(db)
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export async function listCoverLetters(): Promise<CoverLetterRecord[]> {
  const db = await getDb()
  const rows = db.prepare(`
    SELECT id, updated_at, record_json
    FROM cover_letters
    ORDER BY updated_at DESC
  `).all() as SessionRow[]
  return rows.map((row) => JSON.parse(row.record_json) as CoverLetterRecord)
}

export async function getCoverLetter(id: string): Promise<CoverLetterRecord | null> {
  const db = await getDb()
  const row = db.prepare(`
    SELECT id, updated_at, record_json
    FROM cover_letters
    WHERE id = ?
  `).get(id) as SessionRow | undefined
  return row ? (JSON.parse(row.record_json) as CoverLetterRecord) : null
}

export function upsertCoverLetter(record: CoverLetterRecord): Promise<CoverLetterRecord> {
  return withLock(async () => {
    const db = await getDb()
    const updatedAt = record.updatedAt || new Date().toISOString()
    const next = { ...record, updatedAt }
    db.prepare(`
      INSERT INTO cover_letters (id, updated_at, record_json)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        record_json = excluded.record_json
    `).run(next.id, updatedAt, JSON.stringify(next))
    return clone(next)
  })
}

export function deleteCoverLetter(id: string): Promise<boolean> {
  return withLock(async () => {
    const db = await getDb()
    const result = db.prepare("DELETE FROM cover_letters WHERE id = ?").run(id)
    return Number(result.changes) > 0
  })
}
