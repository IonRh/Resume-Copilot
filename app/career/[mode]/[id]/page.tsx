"use client"

import { use, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Icon } from "@iconify/react"
import type { StoredResume } from "@/types/resume"
import { getResumeById } from "@/lib/storage"
import CareerWorkspace from "@/components/workspace/career-workspace"

type CareerMode = "jd" | "interview" | "discover"
const VALID_MODES: CareerMode[] = ["jd", "interview", "discover"]

export default function CareerPage({ params }: { params: Promise<{ mode: string; id: string }> }) {
  const { mode, id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const [entry, setEntry] = useState<StoredResume | null>(null)
  const [loaded, setLoaded] = useState(false)

  const isValidMode = VALID_MODES.includes(mode as CareerMode)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    if (!isValidMode) {
      setEntry(null)
      setLoaded(true)
      return
    }
    void getResumeById(id)
      .then((resume) => {
        if (!cancelled) setEntry(resume)
      })
      .catch(() => {
        if (!cancelled) setEntry(null)
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [id, isValidMode])

  if (loaded && (!isValidMode || !entry)) {
    return (
      <main className="min-h-screen bg-background p-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2 bg-transparent" onClick={() => router.push("/resumes")}>
            <Icon icon="mdi:arrow-left" className="h-4 w-4" /> 返回
          </Button>
          <span className="text-sm text-destructive">
            {isValidMode ? "未找到该简历" : "无效的工具类型"}
          </span>
        </div>
      </main>
    )
  }

  if (!loaded || !entry) {
    return <main className="min-h-screen bg-background" />
  }

  return (
    <main className="min-h-screen bg-background">
      <CareerWorkspace
        mode={mode as CareerMode}
        entryId={id}
        initialData={entry.resumeData}
        sessionId={searchParams.get("session") || undefined}
        onBack={() => router.push("/resumes")}
      />
    </main>
  )
}
