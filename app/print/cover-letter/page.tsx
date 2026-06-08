import CoverLetterPrintContent from "@/components/cover-letter-print-content"
import type { CoverLetterPrintPayload } from "@/lib/cover-letter-pdf"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function decodeDataParam(data?: string): CoverLetterPrintPayload | null {
  if (!data) return null
  try {
    const json = Buffer.from(decodeURIComponent(data), "base64").toString("utf-8")
    return JSON.parse(json) as CoverLetterPrintPayload
  } catch {
    return null
  }
}

export default async function CoverLetterPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string; auto?: string }> | { data?: string; auto?: string }
}) {
  const awaited = await Promise.resolve(
    searchParams as { data?: string; auto?: string } | Promise<{ data?: string; auto?: string }>,
  )
  const printData = decodeDataParam(awaited.data)
  const auto = String(awaited.auto ?? "").toLowerCase()
  const autoPrint = auto === "1" || auto === "true" || auto === "yes"

  return <CoverLetterPrintContent initialData={printData} autoPrint={autoPrint} />
}
