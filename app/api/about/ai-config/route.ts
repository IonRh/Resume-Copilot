import { loadPublicAiProviderConfig, saveAiProviderConfig } from "@/lib/server/ai-config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return Response.json(await loadPublicAiProviderConfig())
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 })
  }

  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  await saveAiProviderConfig(input)
  return Response.json(await loadPublicAiProviderConfig())
}
