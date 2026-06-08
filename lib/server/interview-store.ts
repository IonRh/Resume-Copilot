import { mkdir } from "node:fs/promises"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import type { PersistedAgentState } from "@/lib/agent/store"
import type { StoredCampaignReport } from "@/types/interview-report"
import type { InterviewRoundHandoff, InterviewSessionRecord } from "@/types/interview-session"

const DATA_DIR = path.join(process.cwd(), "data")
const SQLITE_STORE_PATH = path.join(DATA_DIR, "interviews.sqlite")

type SessionRow = {
  id: string
  updated_at: string
  record_json: string
}

type JsonRow = {
  value_json: string
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
    CREATE TABLE IF NOT EXISTS interview_sessions (
      id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL,
      record_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS interview_agent_states (
      storage_key TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL,
      state_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS interview_handoffs (
      from_session_id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL,
      value_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS interview_reports (
      campaign_id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL,
      value_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_interview_sessions_updated_at ON interview_sessions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_interview_agent_states_updated_at ON interview_agent_states(updated_at DESC);
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

export async function listInterviewSessions(): Promise<InterviewSessionRecord[]> {
  const db = await getDb()
  const rows = db.prepare(`
    SELECT id, updated_at, record_json
    FROM interview_sessions
    ORDER BY updated_at DESC
  `).all() as SessionRow[]
  return rows.map((row) => JSON.parse(row.record_json) as InterviewSessionRecord)
}

export async function getInterviewSession(id: string): Promise<InterviewSessionRecord | null> {
  const db = await getDb()
  const row = db.prepare(`
    SELECT id, updated_at, record_json
    FROM interview_sessions
    WHERE id = ?
  `).get(id) as SessionRow | undefined
  return row ? (JSON.parse(row.record_json) as InterviewSessionRecord) : null
}

export function upsertInterviewSession(record: InterviewSessionRecord): Promise<InterviewSessionRecord> {
  return withLock(async () => {
    const db = await getDb()
    const updatedAt = record.updatedAt || new Date().toISOString()
    const next = { ...record, updatedAt }
    db.prepare(`
      INSERT INTO interview_sessions (id, updated_at, record_json)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        record_json = excluded.record_json
    `).run(next.id, updatedAt, JSON.stringify(next))
    return clone(next)
  })
}

export function patchInterviewSession(
  id: string,
  updater: (record: InterviewSessionRecord) => InterviewSessionRecord,
): Promise<InterviewSessionRecord | null> {
  return withLock(async () => {
    const current = await getInterviewSession(id)
    if (!current) return null
    const next = updater(current)
    const updatedAt = next.updatedAt || new Date().toISOString()
    const patched = { ...next, updatedAt }
    const db = await getDb()
    db.prepare(`
      UPDATE interview_sessions
      SET updated_at = ?, record_json = ?
      WHERE id = ?
    `).run(updatedAt, JSON.stringify(patched), id)
    return clone(patched)
  })
}

export function deleteInterviewSession(id: string): Promise<boolean> {
  return withLock(async () => {
    const db = await getDb()
    const result = db.prepare("DELETE FROM interview_sessions WHERE id = ?").run(id)
    return Number(result.changes) > 0
  })
}

export function deleteInterviewAgentStates(keys: string[]): Promise<number> {
  return withLock(async () => {
    if (!keys.length) return 0
    const db = await getDb()
    const placeholders = keys.map(() => "?").join(", ")
    const result = db.prepare(`DELETE FROM interview_agent_states WHERE storage_key IN (${placeholders})`).run(...keys)
    return Number(result.changes)
  })
}

export async function getInterviewAgentState(storageKey: string): Promise<PersistedAgentState | null> {
  const db = await getDb()
  const row = db.prepare(`
    SELECT state_json AS value_json
    FROM interview_agent_states
    WHERE storage_key = ?
  `).get(storageKey) as JsonRow | undefined
  return row ? (JSON.parse(row.value_json) as PersistedAgentState) : null
}

export function saveInterviewAgentState(storageKey: string, state: PersistedAgentState): Promise<void> {
  return withLock(async () => {
    const db = await getDb()
    db.prepare(`
      INSERT INTO interview_agent_states (storage_key, updated_at, state_json)
      VALUES (?, ?, ?)
      ON CONFLICT(storage_key) DO UPDATE SET
        updated_at = excluded.updated_at,
        state_json = excluded.state_json
    `).run(storageKey, new Date().toISOString(), JSON.stringify(state))
  })
}

export async function getInterviewHandoff(fromSessionId: string): Promise<InterviewRoundHandoff | null> {
  const db = await getDb()
  const row = db.prepare(`
    SELECT value_json
    FROM interview_handoffs
    WHERE from_session_id = ?
  `).get(fromSessionId) as JsonRow | undefined
  return row ? (JSON.parse(row.value_json) as InterviewRoundHandoff) : null
}

export function saveInterviewHandoff(handoff: InterviewRoundHandoff): Promise<InterviewRoundHandoff> {
  return withLock(async () => {
    const db = await getDb()
    db.prepare(`
      INSERT INTO interview_handoffs (from_session_id, updated_at, value_json)
      VALUES (?, ?, ?)
      ON CONFLICT(from_session_id) DO UPDATE SET
        updated_at = excluded.updated_at,
        value_json = excluded.value_json
    `).run(handoff.fromSessionId, handoff.generatedAt || new Date().toISOString(), JSON.stringify(handoff))
    return clone(handoff)
  })
}

export function deleteInterviewHandoff(fromSessionId: string): Promise<boolean> {
  return withLock(async () => {
    const db = await getDb()
    const result = db.prepare("DELETE FROM interview_handoffs WHERE from_session_id = ?").run(fromSessionId)
    return Number(result.changes) > 0
  })
}

export async function getInterviewReport(campaignId: string): Promise<StoredCampaignReport | null> {
  const db = await getDb()
  const row = db.prepare(`
    SELECT value_json
    FROM interview_reports
    WHERE campaign_id = ?
  `).get(campaignId) as JsonRow | undefined
  return row ? (JSON.parse(row.value_json) as StoredCampaignReport) : null
}

export function saveInterviewReport(report: StoredCampaignReport): Promise<StoredCampaignReport> {
  return withLock(async () => {
    const db = await getDb()
    db.prepare(`
      INSERT INTO interview_reports (campaign_id, updated_at, value_json)
      VALUES (?, ?, ?)
      ON CONFLICT(campaign_id) DO UPDATE SET
        updated_at = excluded.updated_at,
        value_json = excluded.value_json
    `).run(report.campaignId, report.generatedAt || new Date().toISOString(), JSON.stringify(report))
    return clone(report)
  })
}
