import AuthForm from "@/components/auth-form";

const FEATURES = [
  "AI 润色改写",
  "AI 量化 STAR",
  "AI 简历体检",
  "AI 分析 JD 匹配",
  "AI 推荐岗位方向",
  "AI 对话建简历",
  "AI 模拟面试",
  "AI 面试复盘",
  "AI 写自荐信",
] as const;

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; e?: string }>;
}) {
  const sp = await searchParams;
  const from = sp?.from || "/";
  const errorMessage = sp?.e || "";

  return (
    <main className="auth-hero min-h-screen px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl items-center">
        <div className="w-full px-2 py-8 sm:px-4 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_460px] lg:items-stretch">
            <section className="flex max-w-3xl flex-col justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  写简历 · 练面试 · 投岗位，一站搞定
                </div>
                <h1 className="mt-5 text-3xl font-bold leading-tight sm:text-5xl">
                  <span className="brand-gradient-text">智简Copilot</span>
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                  改简历、对 JD、练面试、写求职信——求职路上该烦的事，帮你少烦一点。
                </p>
              </div>
              <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 lg:mt-10">
                {FEATURES.map((label, index) => (
                  <div
                    key={label}
                    className="auth-feature-card"
                    style={{ "--auth-glow-delay": `${index * 0.6}s` } as React.CSSProperties}
                  >
                    {label}
                  </div>
                ))}
              </div>
            </section>

            <AuthForm from={from} errorMessage={errorMessage} />
          </div>
        </div>
      </div>
    </main>
  );
}
