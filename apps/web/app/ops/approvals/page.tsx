import { now } from '@kora/core';
import Link from 'next/link';
import { ApprovalQueue, type QueueItem } from '@/components/kora/approval-queue';
import { Button } from '@/components/ui/button';
import { loadApprovalDetail, loadApprovalQueue } from '@/lib/ops/data';

export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'decided', 'expired', 'all'] as const;
type Status = (typeof STATUSES)[number];

/** Bands in minor units. The last one is open-ended. */
const BANDS = [
  { label: 'Any value', query: '' },
  { label: 'Under 1k', query: 'maxValueMinor=100000' },
  { label: '1k to 5k', query: 'minValueMinor=100000&maxValueMinor=500000' },
  { label: '5k to 25k', query: 'minValueMinor=500000&maxValueMinor=2500000' },
  { label: '25k and up', query: 'minValueMinor=2500000' },
];

interface RawParams {
  status?: string;
  scope?: string;
  tool?: string;
  minValueMinor?: string;
  maxValueMinor?: string;
}

function positiveInt(raw: string | undefined): number | undefined {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : undefined;
}

function startOfToday(today: Date): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const params = await searchParams;
  const status: Status = STATUSES.find((s) => s === params.status) ?? 'pending';
  const min = positiveInt(params.minValueMinor);
  const max = positiveInt(params.maxValueMinor);

  const approvals = await loadApprovalQueue({
    status,
    ...(params.scope === 'today' ? { decidedSince: startOfToday(now()) } : {}),
    ...(params.tool ? { toolName: params.tool } : {}),
    ...(min !== undefined ? { minValueMinor: min } : {}),
    ...(max !== undefined ? { maxValueMinor: max } : {}),
  });

  const items: QueueItem[] = await Promise.all(
    approvals.map(async (approval) => {
      const detail = await loadApprovalDetail(approval.id);
      return {
        ...approval,
        conversation: detail?.messages ?? [],
        order: detail?.order ?? null,
        customer: detail?.customer ?? null,
      };
    }),
  );

  const tools = [...new Set(approvals.map((a) => a.toolName))].sort();
  const bandQuery = [
    min !== undefined ? `minValueMinor=${min}` : '',
    max !== undefined ? `maxValueMinor=${max}` : '',
  ]
    .filter(Boolean)
    .join('&');

  const withFilters = (overrides: { status?: Status; tool?: string; band?: string }) => {
    const next = new URLSearchParams({ status: overrides.status ?? status });
    const tool = overrides.tool ?? params.tool ?? '';
    if (tool) next.set('tool', tool);
    for (const pair of (overrides.band ?? bandQuery).split('&').filter(Boolean)) {
      const [key, value] = pair.split('=');
      if (key && value) next.set(key, value);
    }
    return `/ops/approvals?${next.toString()}`;
  };

  return (
    <main className="flex flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="font-semibold text-2xl tracking-tight">Approvals</h1>
        <p className="text-muted-foreground text-sm">
          Sorted by money at risk, highest first. Anything past half its approval window is marked.
          An approval past its expiry is handed to a person the moment this page is opened.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((option) => (
            <Button
              key={option}
              asChild
              size="sm"
              variant={status === option && params.scope !== 'today' ? 'default' : 'outline'}
            >
              <Link href={withFilters({ status: option })}>{option}</Link>
            </Button>
          ))}
          <Button asChild size="sm" variant={params.scope === 'today' ? 'default' : 'outline'}>
            <Link href="/ops/approvals?status=decided&scope=today">Decided today</Link>
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {BANDS.map((band) => (
            <Button
              key={band.label}
              asChild
              size="sm"
              variant={bandQuery === band.query ? 'secondary' : 'ghost'}
            >
              <Link href={withFilters({ band: band.query })}>{band.label}</Link>
            </Button>
          ))}
        </div>

        {tools.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant={params.tool ? 'ghost' : 'secondary'}>
              <Link href={withFilters({ tool: '' })}>All tools</Link>
            </Button>
            {tools.map((tool) => (
              <Button
                key={tool}
                asChild
                size="sm"
                variant={params.tool === tool ? 'secondary' : 'ghost'}
              >
                <Link href={withFilters({ tool })}>{tool}</Link>
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      <ApprovalQueue items={items} />
    </main>
  );
}
