import type { ReportCompetency } from "@/types/interview-report"

function polarPoint(center: number, radius: number, index: number, total: number, value: number): string {
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2
  const r = (Math.max(0, Math.min(100, value)) / 100) * radius
  const x = center + r * Math.cos(angle)
  const y = center + r * Math.sin(angle)
  return `${x},${y}`
}

export default function ReportRadar({ competencies }: { competencies: ReportCompetency[] }) {
  if (!competencies.length) return null

  const size = 280
  const center = size / 2
  const radius = 96
  const levels = [25, 50, 75, 100]
  const points = competencies
    .map((item, index) => polarPoint(center, radius, index, competencies.length, item.score))
    .join(" ")

  return (
    <div className="flex flex-col items-center gap-4 lg:flex-row lg:items-start">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-64 w-64 shrink-0">
        {levels.map((level) => (
          <polygon
            key={level}
            points={competencies
              .map((_, index) => polarPoint(center, radius, index, competencies.length, level))
              .join(" ")}
            fill="none"
            stroke="currentColor"
            className="text-border"
            strokeWidth="1"
          />
        ))}
        {competencies.map((item, index) => {
          const end = polarPoint(center, radius, index, competencies.length, 100)
          return (
            <line
              key={item.key}
              x1={center}
              y1={center}
              x2={end.split(",")[0]}
              y2={end.split(",")[1]}
              stroke="currentColor"
              className="text-border"
              strokeWidth="1"
            />
          )
        })}
        <polygon points={points} fill="rgba(236, 72, 153, 0.25)" stroke="#ec4899" strokeWidth="2" />
        {competencies.map((item, index) => {
          const [x, y] = polarPoint(center, radius, index, competencies.length, item.score).split(",")
          return <circle key={item.key} cx={x} cy={y} r="3.5" fill="#ec4899" />
        })}
      </svg>
      <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
        {competencies.map((item) => (
          <div key={item.key} className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-center">
            <div className="text-xs text-muted-foreground">{item.label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{item.score}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
