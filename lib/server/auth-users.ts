import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

const DATA_DIR = path.join(process.cwd(), "data")
const USERS_PATH = path.join(DATA_DIR, "users.json")
const DEFAULT_USERNAME = "admin"
const DEFAULT_PASSWORD = "admin"

export const AUTH_COOKIE = "site_auth"

type StoredUser = {
  username: string
  salt: string
  passwordHash: string
  createdAt: string
}

type UserFile = {
  version: 1
  users: StoredUser[]
}

function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${password}`).digest("hex")
}

function tokenFor(user: StoredUser): string {
  const signature = createHash("sha256")
    .update(`${user.username}:${user.passwordHash}`)
    .digest("hex")
  return `${user.username}:${signature}`
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true })
}

function defaultAdmin(now = new Date().toISOString()): StoredUser {
  const salt = "default-admin"
  return {
    username: DEFAULT_USERNAME,
    salt,
    passwordHash: hashPassword(DEFAULT_PASSWORD, salt),
    createdAt: now,
  }
}

function parseUsers(raw: string): UserFile | null {
  try {
    const parsed = JSON.parse(raw) as Partial<UserFile>
    if (!parsed || !Array.isArray(parsed.users)) return null
    const users = parsed.users
      .map((user) => ({
        username: normalizeUsername(user.username),
        salt: typeof user.salt === "string" ? user.salt : "",
        passwordHash: typeof user.passwordHash === "string" ? user.passwordHash : "",
        createdAt: typeof user.createdAt === "string" ? user.createdAt : new Date().toISOString(),
      }))
      .filter((user) => user.username && user.salt && user.passwordHash)
    return { version: 1, users }
  } catch {
    return null
  }
}

let writeChain: Promise<unknown> = Promise.resolve()

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task)
  writeChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function readUsers(): Promise<UserFile> {
  await ensureDataDir()
  try {
    const raw = await readFile(USERS_PATH, "utf-8")
    const parsed = parseUsers(raw)
    if (parsed) {
      if (!parsed.users.some((user) => user.username === DEFAULT_USERNAME)) {
        parsed.users.unshift(defaultAdmin())
        await writeUsers(parsed)
      }
      return parsed
    }
  } catch (error: unknown) {
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined
    if (code !== "ENOENT") throw error
  }

  const initial = { version: 1 as const, users: [defaultAdmin()] }
  await writeUsers(initial)
  return initial
}

async function writeUsers(store: UserFile) {
  await ensureDataDir()
  const payload = `${JSON.stringify(store, null, 2)}\n`
  const tmp = `${USERS_PATH}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  await writeFile(tmp, payload, "utf-8")
  await rename(tmp, USERS_PATH)
}

export function getDefaultUsername(): string {
  return DEFAULT_USERNAME
}

export function cleanUsername(value: unknown): string {
  return normalizeUsername(value)
}

export async function verifyUser(username: string, password: string): Promise<string | null> {
  const clean = normalizeUsername(username)
  if (!clean || !password) return null
  const store = await readUsers()
  const user = store.users.find((entry) => entry.username === clean)
  if (!user) return null
  const actual = hashPassword(password, user.salt)
  return safeEqual(actual, user.passwordHash) ? tokenFor(user) : null
}

export async function createUser(username: string, password: string): Promise<string> {
  const clean = normalizeUsername(username)
  if (!/^[a-z0-9_-]{2,32}$/.test(clean)) {
    throw new Error("用户名仅支持 2-32 位字母、数字、下划线或短横线")
  }
  if (password.length < 3) {
    throw new Error("密码至少需要 3 位")
  }

  return withLock(async () => {
    const store = await readUsers()
    if (store.users.some((user) => user.username === clean)) {
      throw new Error("用户名已存在")
    }
    const salt = randomBytes(16).toString("hex")
    const user: StoredUser = {
      username: clean,
      salt,
      passwordHash: hashPassword(password, salt),
      createdAt: new Date().toISOString(),
    }
    store.users.push(user)
    await writeUsers(store)
    return tokenFor(user)
  })
}

export async function verifyAuthToken(token: string): Promise<string | null> {
  const [username, signature] = token.split(":")
  const clean = normalizeUsername(username)
  if (!clean || !signature) return null
  const store = await readUsers()
  const user = store.users.find((entry) => entry.username === clean)
  if (!user) return null
  return safeEqual(signature, tokenFor(user).split(":")[1]) ? clean : null
}
