"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import CoverLetterEditor from "@/components/cover-letter-editor"
import CoverLetterExportButton from "@/components/cover-letter-export-button"
import AgentPanel from "@/components/agent/agent-panel"
import { AGENT_PROFILES } from "@/lib/agent/prompts"
import type { CoverLetterDraft } from "@/lib/agent/types"
import { docToText, emptyCoverLetterDoc, normalizeCoverLetterBody } from "@/lib/cover-letter-document"
import { getCoverLetterById, hasCoverLetterBody, saveCoverLetter } from "@/lib/cover-letters"
import { coverLetterDisplayTitle } from "@/types/cover-letter"
import { ResumeWorkspaceProvider, useResumeWorkspace } from "@/lib/agent/store"
import type { ResumeData } from "@/types/resume"

const emptyCoverLetter: CoverLetterDraft = {
  title: "",
  body: "",
  bodyContent: emptyCoverLetterDoc(),
  scenario: "general",
  highlights: [],
  shortVersion: "",
}

interface CoverLetterWorkspaceProps {
  coverLetterId: string
  resumeId: string
  resumeTitle: string
  initialData: ResumeData
  onBack?: () => void
}

export default function CoverLetterWorkspace(props: CoverLetterWorkspaceProps) {
  const storageKey = `resume.coverLetter.${props.coverLetterId}`
  return (
    <ResumeWorkspaceProvider initialData={props.initialData} storageKey={storageKey}>
      <CoverLetterWorkspaceInner {...props} />
    </ResumeWorkspaceProvider>
  )
}

function CoverLetterWorkspaceInner({ coverLetterId, resumeId, resumeTitle, initialData, onBack }: CoverLetterWorkspaceProps) {
  const ws = useResumeWorkspace()
  const { setAgentOpen, setMode } = ws
  const profile = AGENT_PROFILES.coverLetter
  const hydratedRef = useRef(false)
  const skipFirstSaveRef = useRef(true)
  const appliedCoverLetterChangeIdsRef = useRef(new Set<string>())
  const [draft, setDraft] = useState<CoverLetterDraft>(emptyCoverLetter)
  const [copied, setCopied] = useState<"body" | "short" | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setMode("coverLetter")
    setAgentOpen(true)
  }, [setAgentOpen, setMode])

  const recordMetaRef = useRef<{ createdAt: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void getCoverLetterById(coverLetterId)
      .then((record) => {
        if (cancelled || !record) return
        hydratedRef.current = true
        recordMetaRef.current = { createdAt: record.createdAt }
        setDraft({ ...emptyCoverLetter, ...record.draft })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [coverLetterId])

  useEffect(() => {
    if (!hydratedRef.current || loading) return
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      void saveCoverLetter({
        id: coverLetterId,
        resumeId,
        resumeTitle,
        title: coverLetterDisplayTitle({ title: draft.title, draft, resumeTitle }),
        draft,
        createdAt: recordMetaRef.current?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).catch(() => {
        /* 持久化失败不阻塞使用 */
      })
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [coverLetterId, draft, loading, resumeId, resumeTitle])

  const copyText = useCallback(async (kind: "body" | "short", text: string) => {
    if (!text.trim()) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 1400)
    } catch {
      /* clipboard may be unavailable */
    }
  }, [])

  const hasBody = hasCoverLetterBody(draft)

  const applyCoverLetter = useCallback((next: CoverLetterDraft) => {
    const normalized = normalizeCoverLetterBody(next)
    setDraft({ ...emptyCoverLetter, ...next, ...normalized })
  }, [])

  useEffect(() => {
    for (const item of ws.staged) {
      const draftFromChange = item.change.coverLetterDraft
      if (
        item.status !== "accepted" ||
        !draftFromChange ||
        item.hydrated ||
        appliedCoverLetterChangeIdsRef.current.has(item.change.id)
      ) {
        continue
      }
      appliedCoverLetterChangeIdsRef.current.add(item.change.id)
      applyCoverLetter(draftFromChange)
    }
  }, [applyCoverLetter, ws.staged])

  const handleBodyChange = useCallback((bodyContent: NonNullable<CoverLetterDraft["bodyContent"]>) => {
    setDraft((current) => ({
      ...current,
      bodyContent,
      body: docToText(bodyContent),
    }))
  }, [])

  const displayTitle = coverLetterDisplayTitle({ title: draft.title, draft, resumeTitle })

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">
        <Icon icon="mdi:loading" className="agent-spin mr-1 inline h-4 w-4" /> 加载自荐信…
      </div>
    )
  }

  return (
    <div className="rw-shell">
      <div className="rw-toolbar">
        <div className="flex min-w-0 items-center gap-3">
          <span className="brand-gradient-bg grid h-7 w-7 place-items-center rounded-lg">
            <Icon icon={profile.icon} className="h-4 w-4" />
          </span>
          <h1 className="hidden text-base font-semibold sm:block">{profile.name}</h1>
          <Badge variant="secondary" className="max-w-[220px] truncate text-xs">
            {initialData.title || resumeTitle || "未命名"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {onBack ? (
            <Button variant="outline" size="sm" onClick={() => onBack?.()} className="gap-2 bg-transparent">
              <Icon icon="mdi:arrow-left" className="h-4 w-4" />
              <span className="hidden sm:inline">返回</span>
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 bg-transparent"
            disabled={!hasBody}
            onClick={() => void copyText("body", draft.body || docToText(draft.bodyContent))}
            title="复制正式版"
          >
            <Icon icon={copied === "body" ? "mdi:check" : "mdi:content-copy"} className="h-4 w-4" />
            <span className="hidden sm:inline">{copied === "body" ? "已复制" : "复制"}</span>
          </Button>
          <CoverLetterExportButton
            title={displayTitle}
            draft={draft}
            resumeTitle={resumeTitle}
            disabled={!hasBody}
            className="gap-2 bg-transparent"
          />
        </div>
      </div>

      <div className="cover-letter-body">
        <section className="cover-letter-pane">
          <CoverLetterEditor
            title={draft.title}
            onTitleChange={(title) => setDraft((current) => ({ ...current, title }))}
            content={draft.bodyContent}
            onChange={handleBodyChange}
          />

          {draft.shortVersion?.trim() || draft.highlights?.length ? (
            <div className="cover-letter-side">
              {draft.shortVersion?.trim() ? (
                <div className="cover-letter-note">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold">简短版</div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => void copyText("short", draft.shortVersion || "")}
                    >
                      <Icon icon={copied === "short" ? "mdi:check" : "mdi:content-copy"} className="h-3.5 w-3.5" />
                      {copied === "short" ? "已复制" : "复制"}
                    </Button>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{draft.shortVersion}</p>
                </div>
              ) : null}

              {draft.highlights?.length ? (
                <div className="cover-letter-note">
                  <div className="text-xs font-semibold">引用依据</div>
                  <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                    {draft.highlights.map((item, index) => (
                      <li key={`${item}-${index}`} className="flex gap-1.5">
                        <Icon icon="mdi:check-circle-outline" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <AgentPanel lockedMode="coverLetter" />
      </div>
    </div>
  )
}
