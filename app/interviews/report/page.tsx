import { Suspense } from "react"
import InterviewReportHall from "@/components/interview-report/interview-report-hall"

export default function InterviewReportListPage() {
  return (
    <main className="min-h-screen bg-background">
      <Suspense fallback={null}>
        <InterviewReportHall />
      </Suspense>
    </main>
  )
}
