"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Icon } from "@iconify/react"
import type { StoredResume } from "@/types/resume"
import { getResumeById } from "@/lib/storage"
import BuildWorkspace from "@/components/workspace/build-workspace"
import ImageImportWorkspace from "@/components/workspace/image-import-workspace"

export default function CreatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [entry, setEntry] = useState<StoredResume | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
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
  }, [id])

  if (loaded && !entry) {
    return (
      <main className="min-h-screen bg-background p-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2 bg-transparent" onClick={() => router.push("/resumes")}>
            <Icon icon="mdi:arrow-left" className="h-4 w-4" /> 返回
          </Button>
          <span className="text-sm text-destructive">未找到该简历</span>
        </div>
      </main>
    )
  }

  if (!loaded || !entry) {
    return <main className="min-h-screen bg-background" />
  }

  const Workspace = entry.resumeData.creationMode === "imageImport" ? ImageImportWorkspace : BuildWorkspace

  return (
    <main className="min-h-screen bg-background">
      <Workspace
        entryId={id}
        initialData={entry.resumeData}
        onBack={() => router.push("/resumes")}
      />
    </main>
  )
}
