import { FAILURE_CODES, INTENTS } from '@kora/core';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

const OUTCOMES = ['resolved_automatically', 'escalated', 'failed', 'abandoned'] as const;

/** The four an operator actually opens. Everything else is built from the filters. */
const SAVED_VIEWS = [
  { label: 'Failed today', query: 'outcome=failed&days=1' },
  { label: 'Escalated, unclaimed', query: 'escalated=true&escalationStatus=open' },
  { label: 'Policy violations', query: 'failureCode=POLICY_FAILURE' },
  { label: 'Over latency budget', query: 'failureCode=LATENCY_FAILURE' },
];

const FIELD =
  'h-9 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Select({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string | undefined;
  options: readonly string[];
}) {
  return (
    <label className="flex flex-col gap-1 text-muted-foreground text-xs">
      {label}
      <select name={name} defaultValue={value ?? ''} className={FIELD}>
        <option value="">any</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export interface FilterValues {
  from?: string | undefined;
  to?: string | undefined;
  intent?: string | undefined;
  outcome?: string | undefined;
  failureCode?: string | undefined;
  verified?: string | undefined;
  escalated?: string | undefined;
  escalationStatus?: string | undefined;
}

export function ConversationFilters({ values }: { values: FilterValues }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {SAVED_VIEWS.map((view) => (
          <Button key={view.label} asChild size="sm" variant="outline">
            <Link href={`/ops/conversations?${view.query}`}>{view.label}</Link>
          </Button>
        ))}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <label className="flex flex-col gap-1 text-muted-foreground text-xs">
          From
          <input type="date" name="from" defaultValue={values.from ?? ''} className={FIELD} />
        </label>
        <label className="flex flex-col gap-1 text-muted-foreground text-xs">
          To
          <input type="date" name="to" defaultValue={values.to ?? ''} className={FIELD} />
        </label>
        <Select name="intent" label="Intent" value={values.intent} options={INTENTS} />
        <Select name="outcome" label="Outcome" value={values.outcome} options={OUTCOMES} />
        <Select
          name="failureCode"
          label="Failure code"
          value={values.failureCode}
          options={FAILURE_CODES}
        />
        <Select
          name="verified"
          label="Verified"
          value={values.verified}
          options={['true', 'false']}
        />
        <Select
          name="escalated"
          label="Escalated"
          value={values.escalated}
          options={['true', 'false']}
        />
        <Button type="submit" size="sm">
          Apply
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href="/ops/conversations">Clear</Link>
        </Button>
      </form>
    </div>
  );
}
