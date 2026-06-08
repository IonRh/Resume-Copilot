import { Icon } from "@iconify/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { FullInterviewReport } from "@/types/interview-report"
import ReportRadar from "./report-radar"

function stars(count?: number) {
  if (!count) return null
  return (
    <span className="inline-flex gap-0.5 text-amber-500">
      {Array.from({ length: 5 }).map((_, index) => (
        <Icon
          key={index}
          icon={index < count ? "mdi:star" : "mdi:star-outline"}
          className="h-3.5 w-3.5"
        />
      ))}
    </span>
  )
}

export function reportToMarkdown(report: FullInterviewReport): string {
  const lines = [
    `# ${report.title} · 面试报告`,
    "",
    `**综合得分：${report.overallScore} / 100（${report.overallLabel}）**`,
    "",
    report.summary,
    "",
    "## 能力概览",
    ...report.competencies.map((item) => `- ${item.label}：${item.score}`),
    "",
  ]

  for (const round of report.rounds) {
    lines.push(`## ${round.roundLabel}（${round.score} 分）`, "", round.summary, "")
    round.questions.forEach((item, index) => {
      lines.push(`### Q${index + 1}. ${item.question}`)
      if (item.starRating) lines.push(`评分：${item.starRating}/5 星`)
      lines.push("", "**你的回答**", item.answer, "", "**评价**", item.evaluation)
      if (item.referenceAnswer) {
        lines.push("", "**参考答案**", item.referenceAnswer)
      }
      lines.push("")
    })
  }

  if (report.suggestions.length) {
    lines.push("## 改进建议", "")
    report.suggestions.forEach((item) => {
      lines.push(`### ${item.title}`, item.description)
      if (item.resources?.length) {
        lines.push("", "推荐学习：", ...item.resources.map((resource) => `- ${resource}`))
      }
      lines.push("")
    })
  }

  return lines.join("\n")
}

export default function InterviewReportView({ report }: { report: FullInterviewReport }) {
  const exportMarkdown = () => {
    const blob = new Blob([reportToMarkdown(report)], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${report.title}-面试报告.md`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const exportPdf = () => {
    window.print()
  }

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div />
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2 bg-transparent" onClick={exportPdf}>
            <Icon icon="mdi:file-pdf-box" className="h-4 w-4" /> 导出 PDF
          </Button>
          <Button variant="outline" className="gap-2 bg-transparent" onClick={exportMarkdown}>
            <Icon icon="mdi:language-markdown" className="h-4 w-4" /> 导出 Markdown
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start gap-5">
          <div
            className="score-ring shrink-0"
            style={{ ["--val" as string]: String(report.overallScore) }}
          >
            {report.overallScore}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{report.title}</h2>
              <Badge variant="secondary">{report.overallLabel}</Badge>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{report.summary}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h3 className="text-base font-semibold">能力概览</h3>
        <div className="mt-4">
          <ReportRadar competencies={report.competencies} />
        </div>
      </div>

      <div className="space-y-4">
        {report.rounds.map((round) => (
          <div key={round.roundId} className="rounded-2xl border border-border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">{round.roundLabel}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{round.summary}</p>
              </div>
              <Badge variant="outline" className="text-sm tabular-nums">
                {round.score} 分
              </Badge>
            </div>

            <div className="mt-4 space-y-4">
              {round.questions.map((item, index) => (
                <div key={index} className="rounded-xl border border-border bg-muted/10 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="text-sm font-medium">
                      Q{index + 1}. {item.question}
                    </div>
                    {stars(item.starRating)}
                  </div>
                  <div className="mt-3 space-y-3 text-sm">
                    <div>
                      <div className="mb-1 text-xs font-medium text-muted-foreground">你的回答</div>
                      <p className="leading-relaxed">{item.answer}</p>
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-medium text-muted-foreground">评价</div>
                      <p className="leading-relaxed text-muted-foreground">{item.evaluation}</p>
                    </div>
                    {item.referenceAnswer ? (
                      <div>
                        <div className="mb-1 text-xs font-medium text-muted-foreground">参考答案</div>
                        <p className="leading-relaxed">{item.referenceAnswer}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {report.suggestions.length ? (
        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="text-base font-semibold">改进建议</h3>
          <div className="mt-4 space-y-3">
            {report.suggestions.map((item, index) => (
              <div key={index} className="rounded-xl border border-border bg-muted/10 p-4">
                <div className="text-sm font-medium">{item.title}</div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                {item.resources?.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {item.resources.map((resource) => (
                      <li key={resource}>{resource}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
