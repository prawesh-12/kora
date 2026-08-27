import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-8 px-6">
      <div className="space-y-3">
        <h1 className="font-semibold text-3xl tracking-tight">Kora</h1>
        <p className="text-muted-foreground">
          A support agent that resolves damaged order claims end to end, and shows an operator
          exactly what it did and why.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/chat">Start a conversation</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/ops">Operator console</Link>
        </Button>
      </div>
    </main>
  );
}
