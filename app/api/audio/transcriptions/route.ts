import { loadAiProviderConfig } from "@/lib/server/ai-config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`
}

export async function POST(req: Request) {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return Response.json({ error: "请求体不是合法的 multipart 表单" }, { status: 400 })
  }

  const file = formData.get("file")
  if (!(file instanceof Blob) || file.size === 0) {
    return Response.json({ error: "请上传有效的音频文件" }, { status: 400 })
  }

  const config = await loadAiProviderConfig()
  if (!config.speechApiKey) {
    return Response.json({ error: "语音识别 API Key 未配置，请在 About 页面填写" }, { status: 503 })
  }

  const upstream = new FormData()
  const filename = file instanceof File && file.name ? file.name : "recording.webm"
  upstream.append("file", file, filename)
  upstream.append("model", config.speechModel)

  let response: Response
  try {
    response = await fetch(joinUrl(config.speechBaseUrl, "/audio/transcriptions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.speechApiKey}`,
      },
      body: upstream,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "语音识别服务不可用"
    return Response.json({ error: message }, { status: 502 })
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      (payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : null) ||
      (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : null) ||
      `语音识别失败（${response.status}）`
    return Response.json({ error: message }, { status: response.status })
  }

  const text = payload && typeof payload === "object" && "text" in payload ? String(payload.text || "").trim() : ""
  if (!text) {
    return Response.json({ error: "未识别到有效语音内容" }, { status: 422 })
  }

  return Response.json({ text })
}
