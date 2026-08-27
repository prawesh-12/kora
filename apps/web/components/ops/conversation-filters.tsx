'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import {
  Filters,
  type FilterField,
  type FilterQuery,
  type FilterRule,
} from '@/components/reui/filters/filters';
import { humanizeEnum } from '@/lib/ops/format';
import { cn } from '@/lib/utils';

const OUTCOMES = ['resolved_automatically', 'escalated', 'failed', 'abandoned'] as const;

/** The four an operator actually opens. Everything else is built from the filters. */
const SAVED_VIEWS = [
  { label: 'Failed today', query: 'outcome=failed&days=1' },
  { label: 'Escalated unclaimed', query: 'escalated=true&escalationStatus=open' },
  { label: 'Policy violations', query: 'failureCode=POLICY_FAILURE' },
  { label: 'Over latency budget', query: 'failureCode=LATENCY_FAILURE' },
];

/**
 * A relative window rather than a from/to pair. The operator asks "what broke
 * today", not "what happened between two instants", and a window survives being
 * bookmarked where a pair of absolute dates goes stale overnight.
 */
const WINDOWS = [
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

const IS_ONLY = [{ value: 'is', label: 'is', arity: 'one' as const }];

function options(values: readonly string[]) {
  return values.map((value) => ({ value, label: humanizeEnum(value) }));
}

/**
 * The intent and failure-code lists arrive as props. `@kora/core` re-exports
 * `secrets.ts`, which imports `node:crypto`, so a client component that reads
 * the enums straight from core fails the browser build.
 *
 * Each field is one URL parameter. The chip row joins them with an implicit AND.
 */
function buildFields(
  intents: readonly string[],
  failureCodes: readonly string[],
): FilterField<string>[] {
  return [
    {
      id: 'days',
      label: 'Started',
      type: 'select',
      operators: IS_ONLY,
      options: WINDOWS,
      searchable: false,
    },
    {
      id: 'intent',
      label: 'Intent',
      type: 'select',
      operators: IS_ONLY,
      options: options(intents),
    },
    {
      id: 'outcome',
      label: 'Outcome',
      type: 'select',
      operators: IS_ONLY,
      options: options(OUTCOMES),
    },
    {
      id: 'failureCode',
      label: 'Failure code',
      type: 'select',
      operators: IS_ONLY,
      options: options(failureCodes),
    },
    {
      id: 'verified',
      label: 'Verified',
      type: 'select',
      operators: IS_ONLY,
      searchable: false,
      options: [
        { value: 'true', label: 'yes' },
        { value: 'false', label: 'no' },
      ],
    },
    {
      id: 'escalated',
      label: 'Escalated',
      type: 'select',
      operators: IS_ONLY,
      searchable: false,
      options: [
        { value: 'true', label: 'yes' },
        { value: 'false', label: 'no' },
      ],
    },
    {
      id: 'escalationStatus',
      label: 'Escalation status',
      type: 'select',
      operators: IS_ONLY,
      searchable: false,
      options: [
        { value: 'open', label: 'unclaimed' },
        { value: 'closed', label: 'closed' },
      ],
    },
  ];
}

const FIELD_IDS = [
  'days',
  'intent',
  'outcome',
  'failureCode',
  'verified',
  'escalated',
  'escalationStatus',
];

function isRule(node: unknown): node is FilterRule<string> {
  return (node as FilterRule).type === 'rule';
}

export function ConversationFilters({
  intents,
  failureCodes,
}: {
  intents: readonly string[];
  failureCodes: readonly string[];
}) {
  const fields = useMemo(() => buildFields(intents, failureCodes), [intents, failureCodes]);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();

  // The URL is the source of truth, so a saved view, a drill-in from the failure
  // chart and a chip edit all land in the same place.
  const query = useMemo<FilterQuery<string>>(
    () => ({
      id: 'root',
      type: 'group',
      combinator: 'and',
      rules: FIELD_IDS.flatMap((id) => {
        const value = params.get(id);
        return value ? [{ id, type: 'rule' as const, path: [id], operator: 'is', value }] : [];
      }),
    }),
    [params],
  );

  const onQueryChange = useCallback(
    (next: FilterQuery<string>) => {
      const url = new URLSearchParams();
      for (const node of next.rules) {
        if (!isRule(node)) continue;
        const id = node.path[0];
        if (id && typeof node.value === 'string' && node.value) url.set(id, node.value);
      }
      const qs = url.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router],
  );

  const activeView = SAVED_VIEWS.find((view) => view.query === search);

  return (
    <div className="flex flex-col gap-3">
      <nav
        aria-label="Saved views"
        className="inline-flex w-fit overflow-hidden rounded-[10px] border"
      >
        {SAVED_VIEWS.map((view) => (
          <Link
            aria-current={activeView === view ? 'true' : undefined}
            className={cn(
              'border-r px-3 py-1.5 text-sm last:border-r-0 hover:bg-muted/50',
              activeView === view &&
                'bg-foreground font-medium text-background hover:bg-foreground',
            )}
            href={`/ops/conversations?${view.query}`}
            key={view.label}
          >
            {view.label}
          </Link>
        ))}
      </nav>

      <Filters fields={fields} onQueryChange={onQueryChange} query={query} showClear size="sm" />
    </div>
  );
}
