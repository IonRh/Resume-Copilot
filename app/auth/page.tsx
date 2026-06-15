import AuthForm from "@/components/auth-form";

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; e?: string }>;
}) {
  const sp = await searchParams;
  const from = sp?.from || "/";
  const hasError = Boolean(sp?.e);

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <AuthForm from={from} hasError={hasError} />
    </main>
  );
}
