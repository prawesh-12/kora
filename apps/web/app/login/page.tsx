import { LoginForm } from '@/components/kora/login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div className="space-y-1">
        <h1 className="font-semibold text-2xl tracking-tight">Operator sign in</h1>
        <p className="text-muted-foreground text-sm">
          The operator console needs an account. Customer chat does not.
        </p>
      </div>
      <LoginForm next={next ?? '/ops'} />
    </main>
  );
}
