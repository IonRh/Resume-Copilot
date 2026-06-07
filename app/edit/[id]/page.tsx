"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import ResumeWorkspace from "@/components/workspace/resume-workspace"
import { Button } from "@/components/ui/button"
import { Icon } from "@iconify/react"
import type { ResumeData, StoredResume } from "@/types/resume"
import { getResumeById, updateEntryData } from "@/lib/storage"
import { useToast } from "@/hooks/use-toast"

export default function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { toast } = useToast()
  const [, setCurrentData] = useState<ResumeData | null>(null)
  const [entry, setEntry] = useState<StoredResume | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    void getResumeById(id)
      .then((resume) => {
        if (!cancelled) setEntry(resume)
      })
      .catch((error) => {
        if (!cancelled) {
          toast({
            title: "读取失败",
            description: error instanceof Error ? error.message : "无法读取后台简历",
            variant: "destructive",
          })
          setEntry(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [id, toast])

  const handleSave = async (data: ResumeData) => {
    try {
      const updated = await updateEntryData(id, data)
      setEntry(updated)
      toast({ title: "保存成功", description: new Date(updated.updatedAt).toLocaleString() })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "未知错误"
      toast({ title: "保存失败", description: message, variant: "destructive" })
    }
  }

  if (loaded && !entry) {
    return (
      <main className="min-h-screen bg-background p-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2 bg-transparent" onClick={() => router.push("/resumes")}>
            <Icon icon="mdi:arrow-left" className="w-4 h-4" /> 返回
          </Button>
          <span className="text-sm text-destructive">未找到该简历</span>
        </div>
      </main>
    )
  }

  if (!loaded || !entry) {
    return <main className="min-h-screen bg-background" />
  }

  return (
    <main className="min-h-screen bg-background">
      <ResumeWorkspace
        initialData={entry.resumeData}
        entryId={id}
        onChange={setCurrentData}
        onBack={() => router.push("/resumes")}
        onSave={(data) => handleSave(data)}
      />
    </main>
  )
}
