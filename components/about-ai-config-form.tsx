"use client"

import { useState } from "react"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import type { PublicAiProviderConfig } from "@/lib/server/ai-config"

export default function AboutAiConfigForm({ initialConfig }: { initialConfig: PublicAiProviderConfig }) {
  const { toast } = useToast()
  const [config, setConfig] = useState(initialConfig)
  const [baseUrl, setBaseUrl] = useState(initialConfig.baseUrl)
  const [model, setModel] = useState(initialConfig.model)
  const [apiKey, setApiKey] = useState("")
  const [saving, setSaving] = useState(false)

  async function saveConfig(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      const res = await fetch("/api/about/ai-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl, model, apiKey }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || "保存失败")
      setConfig(payload)
      setBaseUrl(payload.baseUrl)
      setModel(payload.model)
      setApiKey("")
      toast({ title: "配置已保存", description: "新的模型配置会用于后续 AI 请求。" })
    } catch (error) {
      toast({
        title: "保存失败",
        description: error instanceof Error ? error.message : "无法保存模型配置",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={saveConfig} className="overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="border-b bg-muted/30 px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <Icon icon="mdi:robot-outline" className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold">模型配置</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {config.source === "file" ? "使用页面保存的本地配置" : "使用环境变量 / 默认值"}
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium ${
              config.apiKeySet
                ? "border-primary/20 bg-primary/10 text-primary"
                : "border-destructive/20 bg-destructive/10 text-destructive"
            }`}
          >
            <Icon icon={config.apiKeySet ? "mdi:key-check-outline" : "mdi:key-alert-outline"} className="h-3.5 w-3.5" />
            {config.apiKeySet ? `API Key ${config.apiKeyPreview}` : "API Key 未配置"}
          </span>
        </div>
      </div>

      <div className="grid gap-5 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border bg-background px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon icon="mdi:web" className="h-3.5 w-3.5" />
              Base URL
            </div>
            <div className="mt-1 truncate text-sm font-medium">{baseUrl || "https://api.openai.com/v1"}</div>
          </div>
          <div className="rounded-md border bg-background px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon icon="mdi:cube-outline" className="h-3.5 w-3.5" />
              模型
            </div>
            <div className="mt-1 truncate text-sm font-medium">{model || "gpt-5.5"}</div>
          </div>
        </div>

        <div className="grid gap-4 rounded-lg border bg-background p-4">
          <div className="grid gap-2">
            <Label htmlFor="baseUrl" className="flex items-center gap-2 text-sm">
              <Icon icon="mdi:link-variant" className="h-4 w-4 text-primary" />
              Base URL
            </Label>
            <Input
              id="baseUrl"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.openai.com/v1"
              className="h-11 font-mono text-sm"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="apiKey" className="flex items-center gap-2 text-sm">
              <Icon icon="mdi:key-variant" className="h-4 w-4 text-primary" />
              API Key
            </Label>
            <Input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={config.apiKeySet ? "留空则继续使用当前 Key" : "请输入 API Key"}
              autoComplete="off"
              className="h-11 font-mono text-sm"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="model" className="flex items-center gap-2 text-sm">
              <Icon icon="mdi:cube-send" className="h-4 w-4 text-primary" />
              模型
            </Label>
            <Input
              id="model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="gpt-5.5"
              className="h-11 font-mono text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end border-t pt-5">
          <Button type="submit" disabled={saving} className="h-10 gap-2 px-5">
            {saving ? (
              <Icon icon="mdi:loading" className="agent-spin h-4 w-4" />
            ) : (
              <Icon icon="mdi:content-save-outline" className="h-4 w-4" />
            )}
            保存配置
          </Button>
        </div>
      </div>
    </form>
  )
}
