import { now } from '@kora/core';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ApprovalQueue, type QueueItem } from '@/components/kora/approval-queue';
import { EmptyState } from '@/components/kora/states';
import { loadApprovalDetail, loadApprovalQueue } from '@/lib/ops/data';
import { cn } from '@/lib/utils';

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
    <div className="flex flex-col gap-6 p-8">
      <header className="space-y-1">
        <h1 className="font-semibold text-xl tracking-tight">Approvals</h1>
        <p className="text-muted-foreground text-sm">
          Sorted by money at risk, highest first. Anything past half its approval window is marked.
          An approval past its expiry is handed to a person the moment this page is opened.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <ChipGroup label="Status">
          {STATUSES.map((option) => (
            <Chip
              active={status === option && params.scope !== 'today'}
              href={withFilters({ status: option })}
              key={option}
            >
              {option}
            </Chip>
          ))}
          <Chip active={params.scope === 'today'} href="/ops/approvals?status=decided&scope=today">
            decided today
          </Chip>
        </ChipGroup>

        <ChipGroup label="Value at risk">
          {BANDS.map((band) => (
            <Chip
              active={bandQuery === band.query}
              href={withFilters({ band: band.query })}
              key={band.label}
            >
              {band.label}
            </Chip>
          ))}
        </ChipGroup>

        {tools.length > 1 ? (
          <ChipGroup label="Proposed tool">
            <Chip active={!params.tool} href={withFilters({ tool: '' })}>
              any
            </Chip>
            {tools.map((tool) => (
              <Chip active={params.tool === tool} href={withFilters({ tool })} key={tool}>
                {tool.replace(/_/g, ' ')}
              </Chip>
            ))}
          </ChipGroup>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyState
          action={{ label: 'See the rule that decides', href: '/ops/versions' }}
          description="A risky action appears here when the policy engine holds it back for a person. Nothing is waiting right now."
          icon={ShieldCheck}
          title="No approvals waiting"
        />
      ) : (
        <ApprovalQueue items={items} />
      )}
    </div>
  );
}

/** Bands, statuses and tools are three questions, so each says which it answers. */
function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-28 shrink-0 font-medium text-muted-foreground text-xs uppercase tracking-[0.06em]">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({ active, href, children }: { active: boolean; href: string; children: ReactNode }) {
  return (
    <Link
      aria-current={active ? 'true' : undefined}
      className={cn(
        'rounded-full border px-3 py-1 text-sm hover:bg-muted/60',
        active && 'border-foreground bg-foreground text-background hover:bg-foreground',
      )}
      href={href}
    >
      {children}
    </Link>
  );
}
