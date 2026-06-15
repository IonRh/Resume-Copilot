"use client"

import { use, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Icon } from "@iconify/react"
import type { StoredResume } from "@/types/resume"
import { getResumeById } from "@/lib/storage"
import ResumePreview from "@/components/resume-preview"

export default function ViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const entry = useMemo<StoredResume | null>(() => getResumeById(id), [id])

  if (!entry) {
    return (
      <main className="min-h-screen bg-background p-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2 bg-transparent" onClick={() => router.push("/")}>
            <Icon icon="mdi:arrow-left" className="w-4 h-4" /> 返回
          </Button>
          <span className="text-sm text-destructive">未找到该简历</span>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2 bg-transparent" onClick={() => router.push("/")}>
            <Icon icon="mdi:arrow-left" className="w-4 h-4" /> 返回
          </Button>
          <span className="text-sm text-muted-foreground">预览：{entry.resumeData.title}</span>
        </div>
      </div>
      <Separator />
      <div className="p-4">
        <div className="preview-panel w-full">
          <ResumePreview resumeData={entry.resumeData} />
        </div>
      </div>
    </main>
  )
}
