import { Suspense } from "react"
import CoverLetterHub from "@/components/cover-letter-hub"

export default function CoverLettersPage() {
  return (
    <main className="min-h-screen bg-background">
      <Suspense fallback={null}>
        <CoverLetterHub />
      </Suspense>
    </main>
  )
}
