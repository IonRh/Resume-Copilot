import { promises as fs } from "fs"
import path from "path"

export interface AiProviderConfig {
  baseUrl: string
  apiKey: string
  model: string
  source: "file" | "env"
}

export interface PublicAiProviderConfig {
  baseUrl: string
  model: string
  apiKeySet: boolean
  apiKeyPreview: string
  source: AiProviderConfig["source"]
}

interface StoredAiProviderConfig {
  baseUrl?: string
  apiKey?: string
  model?: string
}

const CONFIG_PATH = path.join(process.cwd(), "data", "ai-config.json")
const DEFAULT_BASE_URL = "https://api.openai.com/v1"
const DEFAULT_MODEL = "gpt-5.5"

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

async function readStoredConfig(): Promise<StoredAiProviderConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8")
    const parsed = JSON.parse(raw) as StoredAiProviderConfig
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw error
  }
}

export async function loadAiProviderConfig(): Promise<AiProviderConfig> {
  const stored = await readStoredConfig()
  const hasFileConfig = Boolean(str(stored.baseUrl) || str(stored.apiKey) || str(stored.model))

  return {
    baseUrl: str(stored.baseUrl) || str(process.env.OPENAI_BASE_URL) || DEFAULT_BASE_URL,
    apiKey: str(stored.apiKey) || str(process.env.OPENAI_API_KEY),
    model: str(stored.model) || str(process.env.OPENAI_MODEL) || DEFAULT_MODEL,
    source: hasFileConfig ? "file" : "env",
  }
}

export async function loadResearchProviderConfig(): Promise<AiProviderConfig> {
  const stored = await readStoredConfig()
  const base = await loadAiProviderConfig()

  return {
    baseUrl: str(process.env.RESEARCH_BASE_URL) || str(stored.baseUrl) || base.baseUrl,
    apiKey: str(process.env.RESEARCH_API_KEY) || str(stored.apiKey) || base.apiKey,
    model: str(process.env.RESEARCH_MODEL) || str(stored.model) || base.model,
    source: str(process.env.RESEARCH_BASE_URL) || str(process.env.RESEARCH_API_KEY) || str(process.env.RESEARCH_MODEL)
      ? "env"
      : base.source,
  }
}

export async function saveAiProviderConfig(input: {
  baseUrl?: unknown
  apiKey?: unknown
  model?: unknown
  clearApiKey?: unknown
}): Promise<AiProviderConfig> {
  const previous = await readStoredConfig()
  const next: StoredAiProviderConfig = {
    ...previous,
    baseUrl: str(input.baseUrl) || undefined,
    model: str(input.model) || undefined,
  }

  const nextApiKey = str(input.apiKey)
  if (nextApiKey) {
    next.apiKey = nextApiKey
  } else if (input.clearApiKey === true) {
    next.apiKey = undefined
  }

  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true })
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8")

  return loadAiProviderConfig()
}

export function toPublicAiProviderConfig(config: AiProviderConfig): PublicAiProviderConfig {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeySet: Boolean(config.apiKey),
    apiKeyPreview: maskApiKey(config.apiKey),
    source: config.source,
  }
}

function maskApiKey(apiKey: string): string {
  if (!apiKey) return "未配置"
  if (apiKey.length <= 8) return "已配置"
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
}
