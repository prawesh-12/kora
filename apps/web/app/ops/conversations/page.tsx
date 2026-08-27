import { FAILURE_CODES, INTENTS, type FailureCode, type Intent, now } from '@kora/core';
import type { RunOutcome } from '@kora/core';
import { ConversationFilters } from '@/components/ops/conversation-filters';
import { ConversationTable } from '@/components/ops/conversation-table';
import { loadConversations } from '@/lib/ops/data';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const OUTCOMES: readonly RunOutcome[] = [
  'resolved_automatically',
  'escalated',
  'failed',
  'abandoned',
];

interface RawParams {
  from?: string;
  to?: string;
  days?: string;
  intent?: string;
  outcome?: string;
  failureCode?: string;
  verified?: string;
  escalated?: string;
  escalationStatus?: string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function date(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * `to=2026-08-27` parses as midnight, which would drop every run that happened on
 * the day the operator asked for. A bare date means the whole day.
 */
function endOfDay(raw: string | undefined): Date | undefined {
  const parsed = date(raw);
  if (!parsed || !DATE_ONLY.test(raw ?? '')) return parsed;
  return new Date(parsed.getTime() + 24 * 60 * 60 * 1000 - 1);
}

function flag(raw: string | undefined): boolean | undefined {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

function since(days: string | undefined): Date | undefined {
  const parsed = Number(days);
  if (!Number.isFinite(parsed) || parsed < 1) return undefined;
  const today = now();
  return new Date(today.getTime() - parsed * 24 * 60 * 60 * 1000);
}

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const params = await searchParams;

  const from = date(params.from) ?? since(params.days);
  const to = endOfDay(params.to);
  const intent = INTENTS.find((i): i is Intent => i === params.intent);
  const outcome = OUTCOMES.find((o): o is RunOutcome => o === params.outcome);
  const failureCode = FAILURE_CODES.find((c): c is FailureCode => c === params.failureCode);
  const verified = flag(params.verified);
  const escalated = flag(params.escalated);
  const escalationStatus =
    params.escalationStatus === 'open' || params.escalationStatus === 'closed'
      ? params.escalationStatus
      : undefined;

  const page = await loadConversations(
    {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(intent ? { intent } : {}),
      ...(outcome ? { outcome } : {}),
      ...(failureCode ? { failureCode } : {}),
      ...(verified !== undefined ? { verified } : {}),
      ...(escalated !== undefined ? { escalated } : {}),
      ...(escalationStatus ? { escalationStatus } : {}),
    },
    PAGE_SIZE,
  );

  // The paging fetch has to carry the same filters, or page two would widen them.
  const apiQuery = new URLSearchParams({
    limit: String(PAGE_SIZE),
    ...(from ? { from: from.toISOString() } : {}),
    ...(to ? { to: to.toISOString() } : {}),
    ...(intent ? { intent } : {}),
    ...(outcome ? { outcome } : {}),
    ...(failureCode ? { failureCode } : {}),
    ...(verified !== undefined ? { verified: String(verified) } : {}),
    ...(escalated !== undefined ? { escalated: String(escalated) } : {}),
    ...(escalationStatus ? { escalationStatus } : {}),
  }).toString();

  return (
    <main className="flex flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="font-semibold text-2xl tracking-tight">Conversations</h1>
        <p className="text-muted-foreground text-sm">
          Every run, newest first. Paging is by keyset, so a run that arrives while you are reading
          does not shift the rows below you.
        </p>
      </header>

      <ConversationFilters
        values={{
          from: params.from,
          to: params.to,
          intent: params.intent,
          outcome: params.outcome,
          failureCode: params.failureCode,
          verified: params.verified,
          escalated: params.escalated,
          escalationStatus: params.escalationStatus,
        }}
      />

      <ConversationTable page={page} apiQuery={apiQuery} />
    </main>
  );
}
