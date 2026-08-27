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
  days?: string;
  intent?: string;
  outcome?: string;
  failureCode?: string;
  verified?: string;
  escalated?: string;
  escalationStatus?: string;
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

  const from = since(params.days);
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
    ...(intent ? { intent } : {}),
    ...(outcome ? { outcome } : {}),
    ...(failureCode ? { failureCode } : {}),
    ...(verified !== undefined ? { verified: String(verified) } : {}),
    ...(escalated !== undefined ? { escalated: String(escalated) } : {}),
    ...(escalationStatus ? { escalationStatus } : {}),
  }).toString();

  return (
    <main className="flex flex-col gap-6 p-8">
      <header className="space-y-1">
        <h1 className="font-semibold text-xl tracking-tight">Conversations</h1>
        <p className="text-muted-foreground text-sm">
          Every run, newest first. Paging is by keyset, so a run that arrives while you are reading
          does not shift the rows below you.
        </p>
      </header>

      <ConversationFilters failureCodes={FAILURE_CODES} intents={INTENTS} />

      <ConversationTable page={page} apiQuery={apiQuery} />
    </main>
  );
}
