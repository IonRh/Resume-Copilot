import { promises as fs } from "fs"
import path from "path"
import { AI_CONFIG_DEFAULTS } from "@/lib/ai-config-defaults"

export interface AiProviderConfig {
  baseUrl: string
  apiKey: string
  model: string
  speechBaseUrl: string
  speechApiKey: string
  speechModel: string
  source: "file" | "env"
}

export interface PublicAiProviderConfig {
  source: "file" | "env" | "unset"
  baseUrl: string
  model: string
  apiKeySet: boolean
  apiKeyPreview: string
  speechBaseUrl: string
  speechModel: string
  speechApiKeySet: boolean
  speechApiKeyPreview: string
  researchBaseUrl: string
  researchModel: string
  researchApiKeySet: boolean
  researchApiKeyPreview: string
  researchApiKeyDedicated: boolean
}

interface StoredAiProviderConfig {
  baseUrl?: string
  apiKey?: string
  model?: string
  speechBaseUrl?: string
  speechApiKey?: string
  speechModel?: string
  researchBaseUrl?: string
  researchApiKey?: string
  researchModel?: string
}

const CONFIG_PATH = path.join(process.cwd(), "data", "ai-config.json")

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

function hasStoredConfig(stored: StoredAiProviderConfig): boolean {
  return Boolean(
    str(stored.baseUrl) ||
      str(stored.apiKey) ||
      str(stored.model) ||
      str(stored.speechBaseUrl) ||
      str(stored.speechApiKey) ||
      str(stored.speechModel) ||
      str(stored.researchBaseUrl) ||
      str(stored.researchApiKey) ||
      str(stored.researchModel),
  )
}

function hasEnvConfig(): boolean {
  return Boolean(
    str(process.env.OPENAI_BASE_URL) ||
      str(process.env.OPENAI_API_KEY) ||
      str(process.env.OPENAI_MODEL) ||
      str(process.env.SPEECH_BASE_URL) ||
      str(process.env.SPEECH_API_KEY) ||
      str(process.env.SPEECH_MODEL) ||
      str(process.env.RESEARCH_BASE_URL) ||
      str(process.env.RESEARCH_API_KEY) ||
      str(process.env.RESEARCH_MODEL),
  )
}

function resolveSpeechConfig(stored: StoredAiProviderConfig, base: Pick<AiProviderConfig, "apiKey">) {
  const speechBaseUrl =
    str(stored.speechBaseUrl) ||
    str(process.env.SPEECH_BASE_URL) ||
    AI_CONFIG_DEFAULTS.speechBaseUrl
  const speechModel =
    str(stored.speechModel) ||
    str(process.env.SPEECH_MODEL) ||
    AI_CONFIG_DEFAULTS.speechModel
  const speechApiKey =
    str(stored.speechApiKey) || str(process.env.SPEECH_API_KEY) || base.apiKey

  return { speechBaseUrl, speechApiKey, speechModel }
}

/** 运行时加载：未配置时使用 AI_CONFIG_DEFAULTS 回退，保证服务可尝试连接 */
export async function loadAiProviderConfig(): Promise<AiProviderConfig> {
  const stored = await readStoredConfig()
  const baseUrl =
    str(stored.baseUrl) || str(process.env.OPENAI_BASE_URL) || AI_CONFIG_DEFAULTS.baseUrl
  const apiKey = str(stored.apiKey) || str(process.env.OPENAI_API_KEY)
  const model = str(stored.model) || str(process.env.OPENAI_MODEL) || AI_CONFIG_DEFAULTS.model
  const speech = resolveSpeechConfig(stored, { apiKey })

  return {
    baseUrl,
    apiKey,
    model,
    ...speech,
    source: hasStoredConfig(stored) ? "file" : "env",
  }
}

export async function loadResearchProviderConfig(): Promise<AiProviderConfig> {
  const stored = await readStoredConfig()
  const base = await loadAiProviderConfig()
  const dedicatedApiKey = str(stored.researchApiKey) || str(process.env.RESEARCH_API_KEY)
  const apiKey = dedicatedApiKey || base.apiKey

  return {
    baseUrl:
      str(stored.researchBaseUrl) ||
      str(process.env.RESEARCH_BASE_URL) ||
      base.baseUrl,
    apiKey,
    model:
      str(stored.researchModel) ||
      str(process.env.RESEARCH_MODEL) ||
      base.model,
    ...resolveSpeechConfig(stored, { apiKey }),
    source: base.source,
  }
}

export async function saveAiProviderConfig(input: {
  baseUrl?: unknown
  apiKey?: unknown
  model?: unknown
  speechBaseUrl?: unknown
  speechApiKey?: unknown
  speechModel?: unknown
  researchBaseUrl?: unknown
  researchApiKey?: unknown
  researchModel?: unknown
  clearApiKey?: unknown
  clearSpeechApiKey?: unknown
  clearResearchApiKey?: unknown
}): Promise<AiProviderConfig> {
  const previous = await readStoredConfig()
  const next: StoredAiProviderConfig = { ...previous }

  if (str(input.baseUrl)) next.baseUrl = str(input.baseUrl)
  if (str(input.model)) next.model = str(input.model)
  if (str(input.speechBaseUrl)) next.speechBaseUrl = str(input.speechBaseUrl)
  if (str(input.speechModel)) next.speechModel = str(input.speechModel)
  if (str(input.researchBaseUrl)) next.researchBaseUrl = str(input.researchBaseUrl)
  if (str(input.researchModel)) next.researchModel = str(input.researchModel)

  const nextApiKey = str(input.apiKey)
  if (nextApiKey) {
    next.apiKey = nextApiKey
  } else if (input.clearApiKey === true) {
    next.apiKey = undefined
  }

  const nextSpeechApiKey = str(input.speechApiKey)
  if (nextSpeechApiKey) {
    next.speechApiKey = nextSpeechApiKey
  } else if (input.clearSpeechApiKey === true) {
    next.speechApiKey = undefined
  }

  const nextResearchApiKey = str(input.researchApiKey)
  if (nextResearchApiKey) {
    next.researchApiKey = nextResearchApiKey
  } else if (input.clearResearchApiKey === true) {
    next.researchApiKey = undefined
  }

  if (hasStoredConfig(next)) {
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true })
    await fs.writeFile(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8")
  } else {
    try {
      await fs.unlink(CONFIG_PATH)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }

  return loadAiProviderConfig()
}

/** About 页展示：只返回用户或环境变量里真正配置过的值，不含运行时默认回退 */
export async function loadPublicAiProviderConfig(): Promise<PublicAiProviderConfig> {
  const stored = await readStoredConfig()

  const baseUrl = str(stored.baseUrl) || str(process.env.OPENAI_BASE_URL)
  const model = str(stored.model) || str(process.env.OPENAI_MODEL)
  const apiKey = str(stored.apiKey) || str(process.env.OPENAI_API_KEY)

  const speechBaseUrl = str(stored.speechBaseUrl) || str(process.env.SPEECH_BASE_URL)
  const speechModel = str(stored.speechModel) || str(process.env.SPEECH_MODEL)
  const speechApiKeyDedicated = str(stored.speechApiKey) || str(process.env.SPEECH_API_KEY)

  const researchBaseUrl = str(stored.researchBaseUrl) || str(process.env.RESEARCH_BASE_URL)
  const researchModel = str(stored.researchModel) || str(process.env.RESEARCH_MODEL)
  const researchApiKeyDedicated = str(stored.researchApiKey) || str(process.env.RESEARCH_API_KEY)

  const speechApiKey = speechApiKeyDedicated || apiKey
  const researchApiKey = researchApiKeyDedicated || apiKey

  let source: PublicAiProviderConfig["source"] = "unset"
  if (hasStoredConfig(stored)) source = "file"
  else if (hasEnvConfig()) source = "env"

  return {
    source,
    baseUrl,
    model,
    apiKeySet: Boolean(apiKey),
    apiKeyPreview: maskApiKey(apiKey),
    speechBaseUrl,
    speechModel,
    speechApiKeySet: Boolean(speechApiKey),
    speechApiKeyPreview: speechApiKeyDedicated
      ? maskApiKey(speechApiKeyDedicated)
      : apiKey
        ? `回退 ${maskApiKey(apiKey)}`
        : "未配置",
    researchBaseUrl,
    researchModel,
    researchApiKeySet: Boolean(researchApiKey),
    researchApiKeyPreview: researchApiKeyDedicated
      ? maskApiKey(researchApiKeyDedicated)
      : apiKey
        ? `回退 ${maskApiKey(apiKey)}`
        : "未配置",
    researchApiKeyDedicated: Boolean(researchApiKeyDedicated),
  }
}

function maskApiKey(apiKey: string): string {
  if (!apiKey) return "未配置"
  if (apiKey.length <= 8) return "已配置"
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
}
