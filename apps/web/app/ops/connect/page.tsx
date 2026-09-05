import { serverEnv } from '@kora/core';
import { getStripeFixtures, getStripeSecretEncrypted } from '@kora/db';
import { CheckCircle2, Circle, CircleAlert, KeyRound } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/kora/states';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

/**
 * First-run Connect Stripe screen. What Kora will do, the scopes it needs in
 * plain language, then the real state of the key and the fixtures.
 *
 * The key itself is set by the admin command, not here: a restricted key typed
 * into a browser form is a key in a browser history.
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

interface FixtureManifest {
  testClockId?: string;
  refundWindowDays?: number;
  customers?: Array<{ paymentMethodId?: string }>;
  subscriptions?: Array<{ id?: string }>;
  charges?: Array<{ createdAt?: string }>;
}

function checklist(manifest: FixtureManifest | null) {
  const customers = manifest?.customers ?? [];
  const charges = manifest?.charges ?? [];
  const windowDays = manifest?.refundWindowDays ?? 0;
  const cutoff = Date.now() - windowDays * 86_400_000;

  return [
    { label: 'Test clock frozen at a known time', done: Boolean(manifest?.testClockId) },
    {
      label: 'Customers with payment methods on that clock',
      done: customers.length > 0 && customers.every((c) => Boolean(c.paymentMethodId)),
    },
    {
      label: 'Subscriptions on known prices, one invoice paid',
      done: (manifest?.subscriptions ?? []).length > 0 && charges.length > 0,
    },
    {
      label: 'One charge old enough to fall outside the refund window',
      done:
        windowDays > 0 &&
        charges.some((c) => c.createdAt !== undefined && Date.parse(c.createdAt) < cutoff),
    },
  ];
}

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const unreachable = error === 'unreachable';
  const tenantId = serverEnv().KORA_TENANT_ID;
  const [keySet, manifest] = await Promise.all([
    getStripeSecretEncrypted(tenantId).then(Boolean),
    getStripeFixtures(tenantId) as Promise<FixtureManifest | null>,
  ]);
  const fixtures = checklist(manifest);

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
          <Link href={keySet ? '/ops' : '/ops/connect#set-the-key'}>
            {keySet ? 'Open the console' : 'Connect Stripe'}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/chat">Open the customer chat</Link>
        </Button>
      </div>
      <section className="space-y-2" id="set-the-key">
        <h2 className="font-medium text-lg">Set the key</h2>
        <p className="text-muted-foreground text-sm">
          Run this once per tenant. The key is encrypted before it is stored and is never shown
          again.
        </p>
        <p className="tnum font-mono text-xs">
          pnpm kora stripe:set-key --tenant {tenantId} --key sk_test_…
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium text-lg">Fixtures checklist</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {fixtures.map((fixture) => (
            <li className="flex items-start gap-2" key={fixture.label}>
              {fixture.done ? (
                <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success-strong" />
              ) : (
                <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <span>{fixture.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {keySet ? null : (
        <EmptyState
          description="Set the tenant key with the admin command above, then run pnpm kora stripe:fixtures. Running it twice leaves the same state."
          icon={KeyRound}
          title="Key not set yet"
        />
      )}
    </div>
  );
}
