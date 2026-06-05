"use client"

import { useState } from "react"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import { useResumeWorkspace } from "@/lib/agent/store"
import type {
  ChangeKind,
  InterviewCard as InterviewCardType,
  JdCard as JdCardType,
  ScoreCard as ScoreCardType,
  ToolStep,
} from "@/lib/agent/types"

const KIND_META: Record<ChangeKind, { icon: string; label: string }> = {
  text: { icon: "mdi:format-text", label: "文本" },
  structure: { icon: "mdi:file-tree", label: "结构" },
  style: { icon: "mdi:palette-outline", label: "样式" },
  generate: { icon: "mdi:auto-fix", label: "生成" },
}

export function ToolStepView({ step }: { step: ToolStep }) {
  return (
    <div className="tool-step" data-status={step.status}>
      {step.status === "running" ? (
        <Icon icon="mdi:loading" className="agent-spin h-3.5 w-3.5" />
      ) : step.status === "error" ? (
        <span className="tool-step-dot" style={{ background: "#ef4444" }} />
      ) : (
        <span className="tool-step-dot" />
      )}
      <span>{step.label}</span>
      {step.detail ? <span className="truncate opacity-70">· {step.detail}</span> : null}
    </div>
  )
}

export function DiffCard({ changeId }: { changeId: string }) {
  const ws = useResumeWorkspace()
  const staged = ws.getStaged(changeId)
  if (!staged) return null
  const { change, status } = staged
  const meta = KIND_META[change.kind]
  const hasTextDiff = change.before !== undefined || change.after !== undefined

  return (
    <div className="diff-card" data-state={status}>
      <div className="diff-card-head">
        <Icon icon={meta.icon} className="h-4 w-4 text-primary" />
        <span className="flex-1">{change.summary}</span>
        <span className="kw-chip">{meta.label}</span>
      </div>

      <div className="diff-body">
        {hasTextDiff ? (
          <>
            {change.before ? <div className="diff-text diff-before">{change.before}</div> : null}
            <div className="diff-text diff-after">{change.after || "（清空）"}</div>
          </>
        ) : (
          <div className="text-muted-foreground">{change.note || "结构调整"}</div>
        )}
      </div>

      {status === "pending" ? (
        <div className="diff-actions">
          <Button
            size="sm"
            className="brand-gradient-bg h-7 flex-1 gap-1 border-0 text-xs"
            onClick={() => ws.acceptChange(change.id)}
          >
            <Icon icon="mdi:check" className="h-3.5 w-3.5" /> 接受
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 gap-1 bg-transparent text-xs"
            onClick={() => ws.rejectChange(change.id)}
          >
            <Icon icon="mdi:close" className="h-3.5 w-3.5" /> 拒绝
          </Button>
        </div>
      ) : (
        <div className="diff-actions text-xs text-muted-foreground">
          <Icon
            icon={status === "accepted" ? "mdi:check-circle" : "mdi:close-circle"}
            className="h-4 w-4"
            style={{ color: status === "accepted" ? "var(--brand-via)" : "#ef4444" }}
          />
          {status === "accepted" ? "已应用" : "已拒绝"}
        </div>
      )}
    </div>
  )
}

export function ScoreCard({ card }: { card: ScoreCardType }) {
  return (
    <div className="analysis-card">
      <div className="analysis-card-head">
        <Icon icon="mdi:chart-box-outline" className="h-4 w-4" /> 简历评分诊断
      </div>
      <div className="space-y-3 p-3">
        <div className="flex items-center gap-3">
          <div className="score-ring" style={{ ["--val" as string]: String(card.overall) }}>
            {card.overall}
          </div>
          <div className="text-sm text-muted-foreground">综合得分（满分 100）</div>
        </div>

        <div className="space-y-2">
          {card.dimensions.map((d) => (
            <div key={d.name}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{d.name}</span>
                <span className="text-muted-foreground">{d.score}</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="brand-gradient-bg h-full rounded-full"
                  style={{ width: `${Math.max(0, Math.min(100, d.score))}%` }}
                />
              </div>
              {d.comment ? <p className="mt-1 text-xs text-muted-foreground">{d.comment}</p> : null}
            </div>
          ))}
        </div>

        {card.strengths?.length ? (
          <div>
            <div className="mb-1 text-xs font-semibold">亮点</div>
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {card.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {card.suggestions?.length ? (
          <div>
            <div className="mb-1 text-xs font-semibold">改进建议</div>
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {card.suggestions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function JdCard({ card, onApply }: { card: JdCardType; onApply: (prompt: string) => void }) {
  return (
    <div className="analysis-card">
      <div className="analysis-card-head">
        <Icon icon="mdi:target" className="h-4 w-4" /> JD 匹配分析
      </div>
      <div className="space-y-3 p-3">
        <div className="flex items-center gap-3">
          <div className="score-ring" style={{ ["--val" as string]: String(card.matchScore) }}>
            {card.matchScore}
          </div>
          <div className="text-sm text-muted-foreground">{card.summary || "与目标岗位的匹配度"}</div>
        </div>

        {card.matchedKeywords.length ? (
          <div>
            <div className="mb-1 text-xs font-semibold">已覆盖关键词</div>
            <div className="flex flex-wrap gap-1">
              {card.matchedKeywords.map((k, i) => (
                <span key={i} className="kw-chip" data-kind="matched">
                  <Icon icon="mdi:check" className="h-3 w-3" />
                  {k}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {card.missingKeywords.length ? (
          <div>
            <div className="mb-1 text-xs font-semibold">缺失/建议补充</div>
            <div className="flex flex-wrap gap-1">
              {card.missingKeywords.map((k, i) => (
                <span key={i} className="kw-chip" data-kind="missing">
                  <Icon icon="mdi:plus" className="h-3 w-3" />
                  {k}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {card.suggestions.length ? (
          <div className="space-y-2">
            <div className="text-xs font-semibold">优化建议</div>
            {card.suggestions.map((s, i) => (
              <div key={i} className="rounded-lg border border-border p-2">
                <div className="text-xs font-medium">{s.section}</div>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.advice}</p>
                {s.prompt ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1.5 h-6 gap-1 bg-transparent text-[11px]"
                    onClick={() => onApply(s.prompt as string)}
                  >
                    <Icon icon="mdi:auto-fix" className="h-3 w-3" /> 让 AI 应用
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function InterviewCard({ card }: { card: InterviewCardType }) {
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const toggle = (i: number) =>
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  return (
    <div className="analysis-card">
      <div className="analysis-card-head">
        <Icon icon="mdi:account-voice" className="h-4 w-4" /> 模拟面试
      </div>
      <div className="space-y-2 p-3">
        {card.intro ? <p className="text-xs text-muted-foreground">{card.intro}</p> : null}
        <ol className="space-y-2">
          {card.questions.map((q, i) => (
            <li key={i} className="rounded-lg border border-border p-2">
              <div className="flex items-start gap-2">
                <span className="brand-gradient-bg mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold">
                  {i + 1}
                </span>
                <div className="flex-1">
                  <div className="text-sm">{q.question}</div>
                  {q.kind ? (
                    <span className="mt-1 inline-block kw-chip text-[10px]">{q.kind}</span>
                  ) : null}
                  {q.hint ? (
                    <div className="mt-1">
                      <button
                        className="text-[11px] text-primary hover:underline"
                        onClick={() => toggle(i)}
                      >
                        {revealed.has(i) ? "收起提示" : "查看作答提示"}
                      </button>
                      {revealed.has(i) ? (
                        <p className="mt-1 text-xs text-muted-foreground">{q.hint}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
        <p className="pt-1 text-[11px] text-muted-foreground">
          在下方输入你的回答，我会逐题点评并追问。
        </p>
      </div>
    </div>
  )
}
