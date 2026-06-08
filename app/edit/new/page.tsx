"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import ResumeWorkspace from "@/components/workspace/resume-workspace"
import type { ResumeData } from "@/types/resume"
import { createEntryFromData, getResumeById } from "@/lib/storage"
import { buildJdVariantTitle, createJdVariantResumeData, parseResumeVariantTitle } from "@/lib/resume-relations"
import { getResumeDisplayName, getResumeStoredName } from "@/lib/resume-display"
import { useToast } from "@/hooks/use-toast"

export default function NewEditPage() {
  // 包裹 Suspense 以满足 useSearchParams 的要求，fallback 为空避免“加载中...”
  return (
    <Suspense fallback={null}>
      <NewEditPageContent />
    </Suspense>
  )
}

function NewEditPageContent() {
  const router = useRouter()
  const search = useSearchParams()
  const { toast } = useToast()

  const cloneId = search.get("clone")
  const variantMode = search.get("variant") === "jd"
  const useExample = search.get("example") === "1" || search.get("example") === "true"

  // 从 sessionStorage 恢复用户中心预加载的数据
  const prefetchedData: ResumeData | undefined = useMemo(() => {
    if (typeof window === "undefined") return undefined
    try {
      const raw = sessionStorage.getItem("new-edit-initial-data")
      if (!raw) return undefined
      const parsed = JSON.parse(raw) as ResumeData
      sessionStorage.removeItem("new-edit-initial-data")
      return parsed
    } catch {
      return undefined
    }
  }, [])

  const [clonedData, setClonedData] = useState<ResumeData | undefined>()
  const [draftDisplayName, setDraftDisplayName] = useState<string | undefined>()
  const [cloneLoaded, setCloneLoaded] = useState(!cloneId)

  useEffect(() => {
    if (!cloneId) {
      setCloneLoaded(true)
      setClonedData(undefined)
      setDraftDisplayName(undefined)
      return
    }
    let cancelled = false
    setCloneLoaded(false)
    void getResumeById(cloneId)
      .then((entry) => {
        if (!cancelled) {
          if (!entry) {
            setClonedData(undefined)
            return
          }
          const parent = {
            id: entry.resumeData.parentResumeId || entry.id,
            title: entry.resumeData.parentResumeTitle || getResumeStoredName(entry),
          }
          const nextDisplayName = variantMode
            ? buildJdVariantTitle(getResumeDisplayName(entry))
            : getResumeDisplayName(entry)
          const nextData = variantMode
            ? {
              ...createJdVariantResumeData(entry.resumeData, parent),
              variantLabel: parseResumeVariantTitle(nextDisplayName)?.label || "岗位定制版",
            }
            : { ...entry.resumeData }
          setClonedData(nextData)
          setDraftDisplayName(nextDisplayName)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast({
            title: "读取克隆源失败",
            description: error instanceof Error ? error.message : "无法读取后台简历",
            variant: "destructive",
          })
          setClonedData(undefined)
        }
      })
      .finally(() => {
        if (!cancelled) setCloneLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [cloneId, toast, variantMode])

  const handleSave = async (current: ResumeData) => {
    try {
      const entry = await createEntryFromData(current, draftDisplayName)
      toast({ title: "保存成功", description: `已创建：${getResumeDisplayName(entry)}` })
      router.replace(`/edit/${entry.id}`)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "未知错误"
      toast({ title: "保存失败", description: message, variant: "destructive" })
    }
  }

  if (!cloneLoaded) {
    return <main className="min-h-screen bg-background" />
  }

  return (
    <main className="min-h-screen bg-background">
      <ResumeWorkspace
        // 优先使用：克隆数据 > 预加载数据
        initialData={clonedData ?? prefetchedData}
        template={useExample ? "example" : "default"}
        entryId={undefined}
        onBack={() => router.push("/resumes")}
        onSave={(d) => handleSave(d)}
      />
    </main>
  )
}
