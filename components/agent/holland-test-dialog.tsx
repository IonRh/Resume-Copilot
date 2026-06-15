"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  HOLLAND_QUESTIONS,
  HOLLAND_TYPE_LABELS,
  formatHollandBriefing,
  scoreHollandAnswers,
  type HollandResult,
} from "@/lib/holland-test"

interface HollandTestDialogProps {
  open: boolean
  onComplete: (result: HollandResult, briefing: string) => void
  onSkip: () => void
}

export default function HollandTestDialog({ open, onComplete, onSkip }: HollandTestDialogProps) {
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<number, boolean>>({})

  const total = HOLLAND_QUESTIONS.length
  const question = HOLLAND_QUESTIONS[index]
  const answered = answers[question?.id ?? 0] !== undefined
  const currentAnswer = question ? answers[question.id] : undefined

  const progress = useMemo(() => Math.round(((index + 1) / total) * 100), [index, total])

  useEffect(() => {
    if (open) {
      setIndex(0)
      setAnswers({})
    }
  }, [open])

  const pick = useCallback(
    (value: boolean) => {
      if (!question) return
      setAnswers((prev) => ({ ...prev, [question.id]: value }))
    },
    [question],
  )

  const finish = useCallback(() => {
    const result = scoreHollandAnswers(answers)
    onComplete(result, formatHollandBriefing(result))
  }, [answers, onComplete])

  const goNext = useCallback(() => {
    if (!answered) return
    if (index >= total - 1) {
      finish()
      return
    }
    setIndex((i) => i + 1)
  }, [answered, finish, index, total])

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1))
  }, [])

  if (!question) return null

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[min(90vh,680px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="border-b px-6 pb-4 pt-6">
          <DialogHeader className="space-y-2 text-left">
            <div className="flex items-center gap-2">
              <span className="brand-icon-bg grid h-9 w-9 shrink-0 place-items-center rounded-lg">
                <Icon icon="mdi:compass-outline" className="h-5 w-5" />
              </span>
              <div>
                <DialogTitle className="text-base">Holland 职业兴趣测试</DialogTitle>
                <DialogDescription className="text-xs">
                  36 题快速测验，结果将与简历一并用于岗位方向推荐
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                第 {index + 1} / {total} 题
              </span>
              <span>{HOLLAND_TYPE_LABELS[question.type]}维度</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="brand-gradient-bg h-full rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <p className="text-sm font-medium leading-relaxed">{question.text}</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {(
              [
                { value: true, label: "是", icon: "mdi:check-circle-outline" },
                { value: false, label: "否", icon: "mdi:close-circle-outline" },
              ] as const
            ).map((opt) => {
              const active = currentAnswer === opt.value
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors ${
                    active
                      ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                      : "border-border bg-card hover:border-primary/40 hover:bg-muted/40"
                  }`}
                  onClick={() => pick(opt.value)}
                >
                  <Icon icon={opt.icon} className={`h-6 w-6 ${active ? "text-primary" : "text-muted-foreground"}`} />
                  <span className={`text-sm font-medium ${active ? "text-primary" : ""}`}>{opt.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-6 py-4">
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={onSkip}>
            不了，直接推荐
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={index === 0} onClick={goPrev}>
              上一题
            </Button>
            <Button
              type="button"
              size="sm"
              className="brand-gradient-bg border-0"
              disabled={!answered}
              onClick={goNext}
            >
              {index >= total - 1 ? "完成并推荐" : "下一题"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
