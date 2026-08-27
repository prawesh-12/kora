import { ApprovalQueue, type QueueItem } from '@/components/kora/approval-queue';
import { loadApprovalDetail, loadPendingApprovals } from '@/lib/ops/data';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const pending = await loadPendingApprovals();

  const items: QueueItem[] = await Promise.all(
    pending.map(async (approval) => {
      const detail = await loadApprovalDetail(approval.id);
      return {
        ...approval,
        conversation: detail?.messages ?? [],
        order: detail?.order ?? null,
        customer: detail?.customer ?? null,
      };
    }),
  );

  return (
    <main className="flex flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="font-semibold text-2xl tracking-tight">Approvals</h1>
        <p className="text-muted-foreground text-sm">
          Every write the policy would not let the agent make on its own. Approving resumes the run;
          denying hands the conversation to a person.
        </p>
      </header>
      <ApprovalQueue items={items} />
    </main>
  );
}
