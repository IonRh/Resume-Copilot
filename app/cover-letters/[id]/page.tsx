"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Icon } from "@iconify/react"
import CoverLetterWorkspace from "@/components/workspace/cover-letter-workspace"
import { getCoverLetterById } from "@/lib/cover-letters"
import { getResumeById } from "@/lib/storage"

export default function CoverLetterEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [loaded, setLoaded] = useState(false)
  const [missing, setMissing] = useState(false)
  const [resumeTitle, setResumeTitle] = useState("")
  const [resumeId, setResumeId] = useState("")
  const [initialData, setInitialData] = useState<Awaited<ReturnType<typeof getResumeById>>>(null)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    void getCoverLetterById(id)
      .then(async (letter) => {
        if (cancelled) return
        if (!letter) {
          setMissing(true)
          return
        }
        const resume = await getResumeById(letter.resumeId)
        if (!resume) {
          setMissing(true)
          return
        }
        setResumeId(letter.resumeId)
        setResumeTitle(letter.resumeTitle)
        setInitialData(resume)
      })
      .catch(() => {
        if (!cancelled) setMissing(true)
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (loaded && (missing || !initialData)) {
    return (
      <main className="min-h-screen bg-background p-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2 bg-transparent" onClick={() => router.push("/cover-letters")}>
            <Icon icon="mdi:arrow-left" className="h-4 w-4" /> 返回
          </Button>
          <span className="text-sm text-destructive">未找到该自荐信或关联简历</span>
        </div>
      </main>
    )
  }

  if (!loaded || !initialData) {
    return <main className="min-h-screen bg-background" />
  }

  return (
    <main className="min-h-screen bg-background">
      <CoverLetterWorkspace
        coverLetterId={id}
        resumeId={resumeId}
        resumeTitle={resumeTitle}
        initialData={initialData.resumeData}
        onBack={() => router.push("/cover-letters")}
      />
    </main>
  )
}
