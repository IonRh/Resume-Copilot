"use client"

import type { ResumeData, ResumeFile } from "@/types/resume"

const BACKUP_DB_NAME = "resume-json-backup"
const BACKUP_STORE_NAME = "handles"

type SaveFilePickerOptions = {
  suggestedName?: string
  types?: Array<{
    description?: string
    accept: Record<string, string[]>
  }>
}

type PermissionStateLike = "granted" | "denied" | "prompt"

type FileSystemPermissionDescriptorLike = {
  mode?: "read" | "readwrite"
}

type FileSystemWritableFileStreamLike = {
  write(data: Blob | BufferSource | string): Promise<void>
  close(): Promise<void>
}

type FileSystemFileHandleLike = {
  kind: "file"
  name: string
  createWritable(): Promise<FileSystemWritableFileStreamLike>
  queryPermission?(descriptor?: FileSystemPermissionDescriptorLike): Promise<PermissionStateLike>
  requestPermission?(descriptor?: FileSystemPermissionDescriptorLike): Promise<PermissionStateLike>
}

declare global {
  interface Window {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>
  }
}

function getBackupDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(BACKUP_DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(BACKUP_STORE_NAME)) {
        db.createObjectStore(BACKUP_STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("无法打开备份数据库"))
  })
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await getBackupDb()
  return await new Promise<T>((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE_NAME, mode)
    const store = tx.objectStore(BACKUP_STORE_NAME)
    const req = fn(store)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("备份数据库操作失败"))
    tx.oncomplete = () => db.close()
    tx.onerror = () => reject(tx.error ?? new Error("备份数据库事务失败"))
  })
}

function buildResumeFile(data: ResumeData): ResumeFile {
  return {
    version: "1.0.0",
    data,
    metadata: {
      exportedAt: new Date().toISOString(),
      appVersion: "0.1.0",
    },
  }
}

function sanitizeFilenameSegment(input: string) {
  return (input || "resume")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 64) || "resume"
}

async function getHandle(entryId: string): Promise<FileSystemFileHandleLike | null> {
  const handle = await withStore<FileSystemFileHandleLike | undefined>("readonly", (store) => store.get(entryId))
  return handle ?? null
}

async function putHandle(entryId: string, handle: FileSystemFileHandleLike): Promise<void> {
  await withStore("readwrite", (store) => store.put(handle, entryId))
}

async function queryWritePermission(handle: FileSystemFileHandleLike): Promise<boolean> {
  const descriptor: FileSystemPermissionDescriptorLike = { mode: "readwrite" }
  const queried = await handle.queryPermission?.(descriptor)
  return queried === "granted"
}

async function requestWritePermission(handle: FileSystemFileHandleLike): Promise<boolean> {
  const descriptor: FileSystemPermissionDescriptorLike = { mode: "readwrite" }
  const requested = await handle.requestPermission?.(descriptor)
  return requested === "granted"
}

async function writeResumeFile(handle: FileSystemFileHandleLike, data: ResumeData, interactive: boolean): Promise<void> {
  const hasPermission = interactive
    ? await requestWritePermission(handle)
    : await queryWritePermission(handle)

  if (!hasPermission) {
    throw new Error("未获得本地 JSON 文件写入权限")
  }
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(buildResumeFile(data), null, 2))
  await writable.close()
}

export function isLocalJsonPersistenceSupported() {
  return typeof window !== "undefined" && !!window.showSaveFilePicker && !!window.indexedDB
}

export async function hasLocalJsonBinding(entryId: string): Promise<boolean> {
  if (!isLocalJsonPersistenceSupported()) return false
  return !!(await getHandle(entryId))
}

export async function bindLocalJsonFile(entryId: string, data: ResumeData): Promise<string> {
  if (!isLocalJsonPersistenceSupported()) {
    throw new Error("当前浏览器不支持本地 JSON 持久化")
  }

  const suggestedName = `${sanitizeFilenameSegment(data.title)}-${entryId.slice(0, 8)}.json`
  const handle = await window.showSaveFilePicker!({
    suggestedName,
    types: [
      {
        description: "Resume JSON",
        accept: { "application/json": [".json"] },
      },
    ],
  })
  await writeResumeFile(handle, data, true)
  await putHandle(entryId, handle)
  return handle.name
}

export async function saveLocalJsonBackup(entryId: string, data: ResumeData): Promise<boolean> {
  if (!isLocalJsonPersistenceSupported()) return false
  const handle = await getHandle(entryId)
  if (!handle) return false
  try {
    await writeResumeFile(handle, data, false)
    return true
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ""
    if (message.includes("未获得本地 JSON 文件写入权限")) {
      return false
    }
    throw error
  }
  return true
}
