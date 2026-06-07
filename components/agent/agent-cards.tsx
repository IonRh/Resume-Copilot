"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"
import { useResumeWorkspace } from "@/lib/agent/store"
import { diffWords } from "@/lib/agent/word-diff"
import { CAREER_BRIEFING_KEY } from "./career-intake-dialog"
import type {
  CareerDirection,
  ChangeKind,
  DiscoverCard as DiscoverCardType,
  InterviewCard as InterviewCardType,
  InterviewDimensionScores,
  InterviewReportCard as InterviewReportCardType,
  JdCard as JdCardType,
  JdSuggestion,
  ScoreCard as ScoreCardType,
  ToolStep,
} from "@/lib/agent/types"

const targetIdPattern = /^(?:element|row|module)#([^\s,，)）;；]+)/i

function normalizeTargetId(id: string): string {
  const value = id.trim()
  const prefixed = value.match(targetIdPattern)
  return prefixed?.[1] || value.replace(/^(?:element|row|module)#/i, "")
}

function normalizeTargetIds(ids: string[]): string[] {
  return [...new Set(ids.map(normalizeTargetId).filter(Boolean))]
}

function attrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function findPreviewTarget(id: string): Element | null {
  if (typeof document === "undefined") return null
  const root = document.querySelector(".rw-preview") || document
  const value = attrValue(normalizeTargetId(id))
  const element = root.querySelector(`[data-element-id="${value}"]`)
  if (element) return element
  const row = root.querySelector(`[data-row-id="${value}"]`)
  if (row) return row
  const module = root.querySelector(`[data-module-id="${value}"]`)
  return module?.querySelector('[data-role="module-title"]') || module
}

/** 滚动并高亮简历预览中的目标元素（依赖预览的 data-* 属性） */
function locateInPreview(ids: string[]): boolean {
  if (ids.length === 0) return false
  for (const id of ids) {
    const el = findPreviewTarget(id)
    if (!el) continue
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    return true
  }
  return false
}

/** 词级差异渲染：删除红色删除线，新增绿色 */
function WordDiff({ before, after }: { before: string; after: string }) {
  const segs = diffWords(before, after)
  return (
    <>
      {segs.map((s, i) =>
        s.op === "equal" ? (
          <span key={i}>{s.text}</span>
        ) : s.op === "delete" ? (
          <span key={i} className="diff-word-del">
            {s.text}
          </span>
        ) : (
          <span key={i} className="diff-word-ins">
            {s.text}
          </span>
        ),
      )}
    </>
  )
}

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
          change.before && change.after ? (
            // 前后都有内容：词级差异，一栏看清增删
            <div className="diff-text diff-merged">
              <WordDiff before={change.before} after={change.after} />
            </div>
          ) : (
            <>
              {change.before ? <div className="diff-text diff-before">{change.before}</div> : null}
              <div className="diff-text diff-after">{change.after || "（清空）"}</div>
            </>
          )
        ) : (
          <div className="text-muted-foreground">{change.note || "结构调整"}</div>
        )}
      </div>

      {status === "pending" && !staged.hydrated ? (
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
      ) : status === "pending" ? (
        <div className="diff-actions text-xs text-muted-foreground">
          <Icon icon="mdi:history" className="h-4 w-4" />
          已恢复记录，如需应用请重新生成
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

function buildDirectionBriefing(d: CareerDirection): string {
  return [
    `目标方向：${d.title}`,
    d.positions?.length ? `参考岗位：${d.positions.join("、")}` : "",
    d.gaps?.length ? `需要补强：${d.gaps.join("；")}` : "",
    "",
    "以上方向来自「岗位方向推荐」。请据此对齐我的简历：分析与该方向的匹配度，并给出可直接落地的优化建议。",
  ]
    .filter(Boolean)
    .join("\n")
}

export function DiscoverCard({ card }: { card: DiscoverCardType }) {
  const router = useRouter()
  const params = useParams()
  const rawId = params?.id
  const resumeId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : ""

  // 按该方向做 JD 匹配：复用 JD 专注页的 briefing 交接（与 JD intake 出口一致）
  const goJdMatch = (d: CareerDirection) => {
    if (!resumeId) return
    try {
      sessionStorage.setItem(
        CAREER_BRIEFING_KEY,
        JSON.stringify({ mode: "jd", resumeId, briefing: buildDirectionBriefing(d) }),
      )
    } catch {
      /* sessionStorage 不可用时仍正常进入 JD 工作台 */
    }
    router.push(`/career/jd/${resumeId}`)
  }

  // 生成该方向子简历：复用克隆 + JD 子版本流程
  const goVariant = () => {
    if (!resumeId) return
    router.push(`/edit/new?clone=${encodeURIComponent(resumeId)}&variant=jd`)
  }

  return (
    <div className="analysis-card">
      <div className="analysis-card-head">
        <Icon icon="mdi:compass-outline" className="h-4 w-4" /> 岗位方向推荐
      </div>
      <div className="space-y-3 p-3">
        {card.summary ? <p className="text-xs text-muted-foreground">{card.summary}</p> : null}
        <div className="space-y-2">
          {card.directions.map((d, i) => (
            <div key={i} className="rounded-lg border border-border p-2.5">
              <div className="flex items-center gap-2">
                <span className="brand-gradient-bg grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold">
                  {i + 1}
                </span>
                <span className="flex-1 text-sm font-semibold">{d.title}</span>
                <span className="kw-chip shrink-0 text-[10px]" data-kind="matched">
                  匹配 {d.matchScore}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="brand-gradient-bg h-full rounded-full"
                  style={{ width: `${Math.max(0, Math.min(100, d.matchScore))}%` }}
                />
              </div>
              {d.reason ? <p className="mt-1.5 text-xs text-muted-foreground">{d.reason}</p> : null}
              {d.positions?.length ? (
                <div className="mt-1.5">
                  <div className="mb-1 text-[11px] font-semibold">典型岗位</div>
                  <div className="flex flex-wrap gap-1">
                    {d.positions.map((p, j) => (
                      <span key={j} className="kw-chip text-[10px]">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {d.gaps?.length ? (
                <div className="mt-1.5">
                  <div className="mb-1 text-[11px] font-semibold">待补强</div>
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                    {d.gaps.map((g, j) => (
                      <li key={j}>{g}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {resumeId ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 bg-transparent text-[11px]"
                    onClick={() => goJdMatch(d)}
                    title="带着这个方向进入 JD 匹配工作台"
                  >
                    <Icon icon="mdi:target" className="h-3.5 w-3.5" /> 按此方向做 JD 匹配
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 bg-transparent text-[11px]"
                    onClick={goVariant}
                    title="基于当前简历生成一份针对该方向的子简历"
                  >
                    <Icon icon="mdi:file-tree" className="h-3.5 w-3.5" /> 生成该方向子简历
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function JdCard({ card, onApply }: { card: JdCardType; onApply: (prompt: string) => void }) {
  const ws = useResumeWorkspace()
  const locate = (ids: string[]) => {
    const normalizedIds = normalizeTargetIds(ids)
    if (!normalizedIds.length) return
    ws.setHighlight([])
    window.setTimeout(() => ws.setHighlight(normalizedIds), 0)
    locateInPreview(normalizedIds)
  }
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
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {s.targetIds?.length ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 gap-1 bg-transparent text-[11px]"
                      onClick={() => locate(s.targetIds as string[])}
                    >
                      <Icon icon="mdi:crosshairs-gps" className="h-3 w-3" /> 定位
                    </Button>
                  ) : null}
                  {s.prompt ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 gap-1 bg-transparent text-[11px]"
                      onClick={() => {
                        onApply(s.prompt as string)
                        if (s.id) ws.setSuggestionStatus(s.id, "applied")
                      }}
                    >
                      <Icon icon="mdi:auto-fix" className="h-3 w-3" /> 让 AI 应用
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** 面板内可折叠的关键词分组：默认折叠，仅显示计数；展开后显示紧凑 chip */
function KeywordGroup({
  label,
  kind,
  keywords,
  recentSet,
  defaultOpen = false,
}: {
  label: string
  kind: "matched" | "missing"
  keywords: string[]
  recentSet?: Set<string>
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (!keywords.length) return null
  return (
    <div className="jd-kw-group" data-open={open ? "1" : undefined}>
      <button className="jd-kw-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="jd-kw-dot" data-kind={kind} />
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{keywords.length}</span>
        <Icon icon="mdi:chevron-down" className={`jd-kw-chevron h-3.5 w-3.5 ${open ? "is-open" : ""}`} />
      </button>
      {open ? (
        <div className="jd-kw-chips">
          {keywords.map((k) => (
            <span key={k} className="kw-chip" data-kind={kind} data-just={recentSet?.has(k) ? "1" : undefined}>
              {k}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * 常驻 JD 匹配面板：贯穿整个会话，展示最新匹配度（含分数变化）、关键词覆盖进度
 * 以及可逐条落地、带完成状态的优化清单。数据源为 workspace 级 ws.jdMatch。
 */
export function JdMatchPanel({
  onApply,
  onRescore,
  rescoring,
  onClose,
}: {
  onApply: (prompt: string) => void
  onRescore?: () => void
  rescoring?: boolean
  /** 作为浮层使用时：头部按钮变为「收起浮层」 */
  onClose?: () => void
}) {
  const ws = useResumeWorkspace()
  const match = ws.jdMatch
  const [collapsed, setCollapsed] = useState(false)
  const [recentlyCovered, setRecentlyCovered] = useState<string[]>([])
  const prevMatchedRef = useRef<Set<string> | null>(null)

  // 检测「缺失 -> 已覆盖」的关键词，做一次性变绿过渡（刷新后 ref 重置，不误触发）
  useEffect(() => {
    if (!match) return
    const currentSet = new Set(match.current.matchedKeywords)
    const prev = prevMatchedRef.current
    prevMatchedRef.current = currentSet
    if (!prev) return
    const newly = match.current.matchedKeywords.filter((k) => !prev.has(k))
    if (!newly.length) return
    setRecentlyCovered(newly)
    const timer = setTimeout(() => setRecentlyCovered([]), 2600)
    return () => clearTimeout(timer)
  }, [match])

  if (!match) return null

  const card = match.current
  const matched = card.matchedKeywords
  const missing = card.missingKeywords
  const totalKw = matched.length + missing.length
  const coverage = totalKw ? Math.round((matched.length / totalKw) * 100) : 0

  const history = match.history
  const prevScore = history.length >= 2 ? history[history.length - 2].score : null
  const delta = prevScore == null ? null : card.matchScore - prevScore

  const activeSuggestions = card.suggestions.filter((s) => s.status !== "dismissed")
  const totalSug = activeSuggestions.length
  const doneSug = activeSuggestions.filter((s) => s.status === "applied").length

  const locate = (ids: string[]) => {
    const normalizedIds = normalizeTargetIds(ids)
    if (!normalizedIds.length) return
    ws.setHighlight([])
    window.setTimeout(() => ws.setHighlight(normalizedIds), 0)
    locateInPreview(normalizedIds)
  }

  const apply = (s: JdSuggestion) => {
    if (s.prompt) onApply(s.prompt)
    if (s.id) ws.setSuggestionStatus(s.id, "applied")
  }

  const recentSet = new Set(recentlyCovered)
  const showBody = onClose ? true : !collapsed

  return (
    <div className="jd-panel">
      <div className="jd-panel-head">
        <div className="flex min-w-0 items-center gap-2">
          <div className="score-ring jd-ring" style={{ ["--val" as string]: String(card.matchScore) }}>
            {card.matchScore}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold">JD 匹配度</span>
              {delta != null && delta !== 0 ? (
                <span className={`jd-delta ${delta > 0 ? "is-up" : "is-down"}`}>
                  <Icon icon={delta > 0 ? "mdi:arrow-up" : "mdi:arrow-down"} className="h-3 w-3" />
                  {delta > 0 ? `+${delta}` : delta}
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              覆盖 {matched.length}/{totalKw} · 清单 {doneSug}/{totalSug}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {onRescore ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={onRescore}
              disabled={rescoring}
              title="基于当前简历重新评估匹配度"
            >
              <Icon
                icon={rescoring ? "mdi:loading" : "mdi:refresh"}
                className={`h-4 w-4 ${rescoring ? "agent-spin" : ""}`}
              />
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => (onClose ? onClose() : setCollapsed((c) => !c))}
            title={onClose ? "收起" : collapsed ? "展开" : "收起"}
          >
            <Icon
              icon={onClose ? "mdi:chevron-up" : collapsed ? "mdi:chevron-down" : "mdi:chevron-up"}
              className="h-4 w-4"
            />
          </Button>
        </div>
      </div>

      <div className="jd-coverage-bar">
        <div className="brand-gradient-bg h-full rounded-full transition-all" style={{ width: `${coverage}%` }} />
      </div>

      {showBody ? (
        <>
          <div className="jd-kw-row">
            <KeywordGroup label="已覆盖" kind="matched" keywords={matched} recentSet={recentSet} />
            <KeywordGroup label="待补充" kind="missing" keywords={missing} defaultOpen />
          </div>

          {totalSug ? (
            <div className="jd-list">
              {activeSuggestions.map((s, i) => {
                const applied = s.status === "applied"
                return (
                  <div key={s.id || i} className="jd-sug" data-status={s.status || "pending"}>
                    <Icon
                      icon={applied ? "mdi:check-circle" : "mdi:circle-outline"}
                      className="jd-sug-icon"
                      style={{ color: applied ? "var(--brand-via)" : undefined }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="jd-sug-title">{s.section}</div>
                      <p className="jd-sug-advice">{s.advice}</p>
                    </div>
                    <div className="jd-sug-actions">
                      {s.targetIds?.length ? (
                        <button
                          className="jd-icon-btn"
                          onClick={() => locate(s.targetIds as string[])}
                          title="定位到简历"
                        >
                          <Icon icon="mdi:crosshairs-gps" className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {s.prompt ? (
                        <button
                          className="jd-icon-btn jd-icon-btn-primary"
                          onClick={() => apply(s)}
                          title={applied ? "再次应用" : "让 AI 应用"}
                        >
                          <Icon icon={applied ? "mdi:refresh" : "mdi:auto-fix"} className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {!applied && s.id ? (
                        <button
                          className="jd-icon-btn"
                          onClick={() => ws.setSuggestionStatus(s.id as string, "dismissed")}
                          title="从清单中忽略"
                        >
                          <Icon icon="mdi:close" className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export function InterviewCard({ card }: { card: InterviewCardType }) {
  const singleQuestion = card.questions.length === 1
  return (
    <div className="analysis-card">
      <div className="analysis-card-head">
        <Icon icon="mdi:account-voice" className="h-4 w-4" /> 模拟面试
      </div>
      <div className="space-y-2 p-3">
        {card.intro ? <p className="text-xs text-muted-foreground">{card.intro}</p> : null}
        {singleQuestion && card.currentIndex && card.total ? (
          <div className="text-xs font-medium text-muted-foreground">
            第 {card.currentIndex} / {card.total} 题
          </div>
        ) : null}
        <ol className="space-y-2">
          {card.questions.map((q, i) => (
            <li key={i} className="rounded-lg border border-border p-2">
              <div className="flex items-start gap-2">
                <span className="brand-gradient-bg mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold">
                  {singleQuestion ? card.currentIndex || 1 : i + 1}
                </span>
                <div className="flex-1">
                  <div className="text-sm">{q.question}</div>
                  {q.kind ? (
                    <span className="mt-1 inline-block kw-chip text-[10px]">{q.kind}</span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
        <p className="pt-1 text-[11px] text-muted-foreground">
          在下方输入你的回答，面试官会继续追问。
        </p>
      </div>
    </div>
  )
}

const DIMENSION_LABELS: { key: keyof InterviewDimensionScores; label: string }[] = [
  { key: "substance", label: "论据" },
  { key: "structure", label: "结构" },
  { key: "relevance", label: "切题" },
  { key: "credibility", label: "可信" },
  { key: "differentiation", label: "差异" },
]

function formatDimensions(dimensions?: InterviewDimensionScores): string | undefined {
  if (!dimensions) return undefined
  const parts = DIMENSION_LABELS.map(({ key, label }) => {
    const v = dimensions[key]
    return v !== undefined ? `${label}${v}` : null
  }).filter(Boolean)
  return parts.length ? parts.join(" · ") : undefined
}

function InterviewDimensionRow({ dimensions }: { dimensions?: InterviewDimensionScores }) {
  if (!dimensions) return null
  const entries = DIMENSION_LABELS.filter(({ key }) => dimensions[key] !== undefined)
  if (!entries.length) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {entries.map(({ key, label }) => (
        <span key={key} className="kw-chip text-[10px]" title={label}>
          {label} {dimensions[key]}
        </span>
      ))}
    </div>
  )
}

function reportToMarkdown(card: InterviewReportCardType): string {
  const lines: string[] = [
    `# 模拟面试表现报告`,
    "",
    `**综合得分：${card.overall} / 100**`,
    "",
  ]
  if (card.summary) lines.push(card.summary, "")
  lines.push("## 逐题评分", "")
  card.items.forEach((it, i) => {
    lines.push(`${i + 1}. (${it.score}/100) ${it.question}`)
    const dimText = formatDimensions(it.dimensions)
    if (dimText) lines.push(`   - 五维：${dimText}`)
    if (it.comment) lines.push(`   - ${it.comment}`)
  })
  if (card.strengths?.length) {
    lines.push("", "## 优势", ...card.strengths.map((s) => `- ${s}`))
  }
  if (card.improvements?.length) {
    lines.push("", "## 待提升", ...card.improvements.map((s) => `- ${s}`))
  }
  return lines.join("\n")
}

export function InterviewReportCard({ card }: { card: InterviewReportCardType }) {
  const exportReport = () => {
    if (typeof document === "undefined") return
    const blob = new Blob([reportToMarkdown(card)], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `面试表现报告-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="analysis-card">
      <div className="analysis-card-head">
        <Icon icon="mdi:clipboard-text-clock-outline" className="h-4 w-4" /> 面试表现报告
      </div>
      <div className="space-y-3 p-3">
        <div className="flex items-center gap-3">
          <div className="score-ring" style={{ ["--val" as string]: String(card.overall) }}>
            {card.overall}
          </div>
          <div className="text-sm text-muted-foreground">{card.summary || "本场模拟面试综合表现"}</div>
        </div>

        <div className="space-y-2">
          {card.items.map((it, i) => (
            <div key={i} className="rounded-lg border border-border p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 text-xs font-medium">
                  {i + 1}. {it.question}
                </div>
                <span className="kw-chip shrink-0 text-[10px]">{it.score}</span>
              </div>
              {it.comment ? <p className="mt-1 text-xs text-muted-foreground">{it.comment}</p> : null}
              <InterviewDimensionRow dimensions={it.dimensions} />
            </div>
          ))}
        </div>

        {card.strengths?.length ? (
          <div>
            <div className="mb-1 text-xs font-semibold">优势</div>
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {card.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {card.improvements?.length ? (
          <div>
            <div className="mb-1 text-xs font-semibold">待提升</div>
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {card.improvements.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <Button
          size="sm"
          variant="outline"
          className="h-7 w-full gap-1 bg-transparent text-xs"
          onClick={exportReport}
        >
          <Icon icon="mdi:download" className="h-3.5 w-3.5" /> 导出报告（Markdown）
        </Button>
      </div>
    </div>
  )
}
