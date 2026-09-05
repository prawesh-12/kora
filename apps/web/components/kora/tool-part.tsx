'use client';

import { ToolApproval } from '@/components/agents/tool-approval';
import { ToolResult } from '@/components/agents/tool-result';

export interface ToolPartData {
  type: string;
  state: 'complete' | 'approval-requested';
}

/** Customer-facing: rule ids, confidence scores and raw tool arguments belong in
 *  the operator trace and must never appear here. */
const PLAIN_LANGUAGE: Record<string, { title: string; outcome: string }> = {
  get_subscription: {
    title: 'Looking up your subscription',
    outcome: 'Found your subscription and its current plan.',
  },
  get_customer: { title: 'Checking your account', outcome: 'Confirmed your account details.' },
  get_invoice: { title: 'Checking your bill', outcome: 'Found the bill behind this charge.' },
  preview_change: {
    title: 'Working out the new amount',
    outcome: 'Previewed what the plan change costs before touching anything.',
  },
  search_knowledge: {
    title: 'Checking our billing policy',
    outcome: 'Read the current policy for this request.',
  },
  check_policy: {
    title: 'Checking what we can do',
    outcome: 'Confirmed what is allowed for this request.',
  },
  create_refund: { title: 'Issuing the refund', outcome: 'Refund confirmed.' },
  cancel_subscription: {
    title: 'Cancelling your subscription',
    outcome: 'Cancellation scheduled.',
  },
  change_plan: { title: 'Changing your plan', outcome: 'Your plan is updated.' },
  create_ticket: { title: 'Opening a ticket', outcome: 'Opened a ticket so this is tracked.' },
  get_order: { title: 'Looking up your order', outcome: 'Found your order and its delivery date.' },
  create_replacement: {
    title: 'Arranging a replacement',
    outcome: 'Created a replacement for the damaged item.',
  },
};

export function ToolPart({ part }: { part: ToolPartData }) {
  const copy = PLAIN_LANGUAGE[part.type];
  if (!copy) return null;

  if (part.state === 'approval-requested') {
    return (
      <ToolApproval
        tool={part.type.replace(/_/g, ' ')}
        title={copy.title}
        description="A colleague is reviewing this before it goes ahead. We will come back to you shortly."
        status="pending"
        data-testid={`tool-approval-${part.type}`}
      />
    );
  }

  return (
    <ToolResult
      tool={part.type.replace(/_/g, ' ')}
      title={copy.title}
      status="success"
      collapseOnComplete
      className="text-sm"
    >
      <p className="px-3 py-2 text-muted-foreground text-sm">{copy.outcome}</p>
    </ToolResult>
  );
}
