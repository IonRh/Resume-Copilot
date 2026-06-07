"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Icon } from "@iconify/react"
import { loadDefaultTemplate, loadExampleTemplate } from "@/lib/storage"

export default function WelcomePage() {
  const router = useRouter()

  useEffect(() => {
    loadDefaultTemplate()
    loadExampleTemplate()
  }, [])

  return (
    <main className="min-h-screen bg-background px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl items-center">
        <div className="ai-hero w-full px-6 py-8 sm:px-10 sm:py-10">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
                <Icon icon="mdi:sparkles" className="h-3.5 w-3.5 text-primary" />
                AI Native · 大学生求职全流程
              </div>
              <h1 className="mt-4 text-3xl font-bold leading-tight sm:text-4xl">
                <span className="brand-gradient-text">AI + 求职</span>
                <span className="text-foreground"> 简历工作区</span>
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
                左侧手工编辑、中间实时预览，右上角呼出 AI Agent 即进入三分屏工作区。
                Agent 可润色改写、调整结构与样式、对照 JD 优化、给出评分诊断与模拟面试，所有改动均以 diff 卡片确认后落地。
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button onClick={() => router.push("/resumes")} className="brand-gradient-bg gap-2 border-0 px-6">
                  <Icon icon="mdi:arrow-right-circle-outline" className="h-4 w-4" />
                  开始
                </Button>
              </div>
              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                {[
                  { icon: "mdi:auto-fix", label: "逐句润色改写" },
                  { icon: "mdi:file-tree", label: "结构智能重排" },
                  { icon: "mdi:target", label: "JD 精准匹配" },
                  { icon: "mdi:chart-box-outline", label: "简历评分诊断" },
                  { icon: "mdi:account-voice", label: "模拟面试" },
                ].map((feature) => (
                  <span key={feature.label} className="inline-flex items-center gap-1.5">
                    <Icon icon={feature.icon} className="h-3.5 w-3.5 text-primary" />
                    {feature.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="hidden shrink-0 sm:block">
              <div className="brand-gradient-bg grid h-28 w-28 place-items-center rounded-3xl shadow-lg shadow-primary/20">
                <Icon icon="mdi:file-account-outline" className="h-14 w-14" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
