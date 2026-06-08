import InterviewCampaignReport from "@/components/interview-report/interview-campaign-report"

export default async function InterviewReportCampaignPage({
  params,
}: {
  params: Promise<{ campaignId: string }>
}) {
  const { campaignId } = await params
  return (
    <main className="min-h-screen bg-background">
      <InterviewCampaignReport campaignId={campaignId} />
    </main>
  )
}
