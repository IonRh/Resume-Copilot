import { Suspense } from "react"
import InterviewHub from "@/components/interview-hub"

export default function InterviewsPage() {
  return (
    <main className="min-h-screen bg-background">
      <Suspense fallback={null}>
        <InterviewHub />
      </Suspense>
    </main>
  )
}
