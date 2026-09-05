import { CheckCircle2, Circle, CircleAlert, KeyRound } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/kora/states';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

/**
 * First-run Connect Stripe screen. What Kora will do, the scopes it needs in
 * plain language, one primary action, then a fixtures checklist.
 *
 * TODO(plan): wire the Connect action to the per-tenant encrypted key store
 * (P5 admin command owns key storage); this screen currently links on to the
 * console once the key is set.
 */
const SCOPES = [
  {
    name: 'Read customers and subscriptions',
    why: 'To find the subscription and the bill behind a request.',
  },
  {
    name: 'Read invoices, charges and payment details',
    why: 'To work out what is still refundable before promising anything.',
  },
  {
    name: 'Create refunds and update subscriptions',
    why: 'To issue the refund or cancel the plan the customer asked for.',
  },
  {
    name: 'Read products and prices',
    why: 'To name the current plan and quote a plan change correctly.',
  },
];

const FIXTURES = [
  'Test clock frozen at a known time',
  'Customers with payment methods on that clock',
  'Subscriptions on known prices, one invoice paid',
  'One charge old enough to fall outside the refund window',
];

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const unreachable = error === 'unreachable';

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-8 p-8">
      <header className="space-y-1">
        <h1 className="font-semibold text-xl tracking-tight">Connect Stripe</h1>
        <p className="text-muted-foreground text-sm">
          Kora acts on your Stripe billing in test mode and proves each action by reading Stripe
          back. One restricted key per tenant, stored encrypted, never shown again.
        </p>
      </header>

      {unreachable ? (
        <p
          className="flex items-start gap-2 rounded-[10px] border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
          role="alert"
        >
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive-strong" />
          Kora cannot reach Stripe with this key. Check the key and its permissions.
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-medium text-lg">What Kora will do</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {SCOPES.map((scope) => (
            <li className="rounded-[10px] border px-4 py-3" key={scope.name}>
              <p className="font-medium">{scope.name}</p>
              <p className="text-muted-foreground">{scope.why}</p>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-sm">
          The key cannot create customers. A tenant with no key cannot run a write: it fails closed
          and a person is brought in.
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/ops">Connect Stripe</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/chat">Open the customer chat</Link>
        </Button>
      </div>
      <p className="tnum font-mono text-muted-foreground text-xs">
        pnpm kora tenant:set-stripe-key --tenant &lt;id&gt;
      </p>

      <section className="space-y-3">
        <h2 className="font-medium text-lg">Fixtures checklist</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {FIXTURES.map((fixture, index) => (
            <li className="flex items-start gap-2" key={fixture}>
              {index < 2 ? (
                <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success-strong" />
              ) : (
                <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <span>{fixture}</span>
            </li>
          ))}
        </ul>
      </section>

      <EmptyState
        action={{ label: 'Read the runbook', href: '/ops/versions' }}
        description="Set the tenant key with the admin command, then run the fixtures script twice and confirm the state matches."
        icon={KeyRound}
        title="Key not set yet"
      />
    </div>
  );
}
