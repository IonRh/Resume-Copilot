import Link from "next/link"
import { Icon } from "@iconify/react"
import AboutAiConfigForm from "@/components/about-ai-config-form"
import LogoutButton from "@/components/logout-button"
import { Button } from "@/components/ui/button"
import { loadPublicAiProviderConfig } from "@/lib/server/ai-config"

export const dynamic = "force-dynamic"

const ORIGINAL_PROJECT_URL = "https://github.com/wzdnzd/resume"
const DEFAULT_PROJECT_URL = "https://github.com/Isla7940-s/Resume-Copilot"

function resolveOurGithubUrl(): string {
  const explicit = (process.env.NEXT_PUBLIC_APP_GITHUB_URL ?? process.env.APP_GITHUB_URL ?? "").trim()
  if (explicit) return explicit

  const repository = (process.env.GITHUB_REPOSITORY ?? "").trim()
  if (repository) return `https://github.com/${repository.replace(/^\/+|\/+$/g, "")}`

  return DEFAULT_PROJECT_URL
}

function InfoLink({ title, href, icon }: { title: string; href: string; icon: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-primary/60 hover:bg-muted/30"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-muted text-primary">
          <Icon icon={icon} className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{href}</span>
        </span>
      </span>
      <Icon
        icon="mdi:open-in-new"
        className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
      />
    </a>
  )
}

export default async function AboutPage() {
  const aiConfig = await loadPublicAiProviderConfig()
  const ourGithubUrl = resolveOurGithubUrl()

  return (
    <main className="min-h-screen bg-background px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1 text-xs text-muted-foreground">
              <Icon icon="mdi:information-outline" className="h-3.5 w-3.5 text-primary" />
              About
            </div>
            <h1 className="mt-3 text-2xl font-semibold">关于智简Copilot</h1>
          </div>
          <div className="flex items-center gap-2">
            <LogoutButton />
            <Button variant="outline" asChild className="gap-2">
              <Link href="/">
                <Icon icon="mdi:arrow-left" className="h-4 w-4" />
                返回
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-4">
          <section className="rounded-lg border bg-card p-5 shadow-sm">
            <h2 className="text-base font-semibold">项目地址</h2>
            <div className="mt-4 grid gap-3">
              {ourGithubUrl ? (
                <InfoLink title="我们的 GitHub" href={ourGithubUrl} icon="mdi:github" />
              ) : (
                <div className="rounded-lg border bg-background p-4 text-sm text-muted-foreground">
                  我们的 GitHub 地址未配置。可设置 `APP_GITHUB_URL` 或 `NEXT_PUBLIC_APP_GITHUB_URL`。
                </div>
              )}
              <InfoLink title="致谢原项目" href={ORIGINAL_PROJECT_URL} icon="mdi:github" />
            </div>
          </section>

          <AboutAiConfigForm initialConfig={aiConfig} />
        </div>
      </div>
    </main>
  )
}
