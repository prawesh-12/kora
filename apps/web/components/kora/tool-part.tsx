'use client';

import { ToolApproval } from '@/components/agents/tool-approval';
import { ToolResult } from '@/components/agents/tool-result';

export interface ToolPartData {
  type: string;
  state: 'complete' | 'approval-requested';
}

/**
 * The customer sees what happened, not how. Rule ids, confidence scores and raw
 * tool arguments belong in the operator trace and never appear here.
 */
const PLAIN_LANGUAGE: Record<string, { title: string; outcome: string }> = {
  get_order: { title: 'Looked up your order', outcome: 'Found your order and its delivery date.' },
  get_customer: { title: 'Checked your account', outcome: 'Confirmed your account details.' },
  search_knowledge: {
    title: 'Checked our returns policy',
    outcome: 'Read the current policy for damaged items.',
  },
  check_policy: {
    title: 'Checked what we can offer',
    outcome: 'Confirmed what is allowed for this order.',
  },
  create_replacement: {
    title: 'Arranged a replacement',
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
