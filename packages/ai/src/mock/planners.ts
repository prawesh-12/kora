import { HUMAN_PHRASES, ORDER_REF, intentPlanner } from './intent-planner.js';
import type { MockPlanner, MockPlannerContext, MockTurn } from './language-model.js';

export { intentPlanner };

interface OrderView {
  id: string;
  status: string;
  items: Array<{ sku: string; category: string; quantity: number; unitAmountMinor: number }>;
  totalAmountMinor: number;
  currency: string;
  deliveredAt: string | null;
  replacementIds: string[];
}

interface ToolFailure {
  ok?: false;
  reason?: string;
  awaitingApproval?: boolean;
}

function findToolResult<T>(ctx: MockPlannerContext, toolName: string): T | null {
  for (let i = ctx.toolResults.length - 1; i >= 0; i--) {
    const r = ctx.toolResults[i];
    if (r && r.toolName === toolName) return r.output as T;
  }
  return null;
}

function isFailure(output: unknown): boolean {
  return Boolean(output && typeof output === 'object' && (output as ToolFailure).ok === false);
}

function called(ctx: MockPlannerContext, name: string): boolean {
  return ctx.calledTools.includes(name);
}

function money(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toLocaleString('en-IN')}`;
}

/**
 * The offline agent. Walks whichever workflow the exposed tool set implies, one
 * tool at a time, reacting to what the previous tool actually returned. It never
 * invents an id or an amount: every fact in a final message comes from a tool
 * result or from the order record.
 */
export const agentPlanner: MockPlanner = (ctx): MockTurn | undefined => {
  if (ctx.options.responseFormat?.type === 'json') return undefined;

  const has = (name: string) => ctx.availableTools.includes(name);
  const text = ctx.customerText.toLowerCase();
  const orderId = text.match(ORDER_REF)?.[1];

  const escalate = (reason: string, message: string): MockTurn => ({
    text: message,
    toolCalls: [{ toolName: 'escalate_to_human', input: { reason, summary: message } }],
  });

  if (HUMAN_PHRASES.some((p) => text.includes(p))) {
    return escalate(
      'CUSTOMER_REQUESTED',
      'Of course. I have passed you to a colleague and someone will be with you shortly.',
    );
  }

  if (!orderId) {
    return escalate(
      'UNSUPPORTED_SCENARIO',
      'I could not find an order number in your message, so I have asked a colleague to pick this up.',
    );
  }

  if (!called(ctx, 'get_order') && has('get_order')) {
    return { toolCalls: [{ toolName: 'get_order', input: { orderId } }] };
  }

  const fetched = findToolResult<OrderView | ToolFailure>(ctx, 'get_order');
  if (!fetched || isFailure(fetched)) {
    return escalate(
      'TOOL_FAILED',
      `I could not look up order ${orderId} just now, so I have asked a colleague to check it. I have not made any changes.`,
    );
  }
  const order = fetched as OrderView;

  const action = has('create_refund')
    ? 'create_refund'
    : has('cancel_order')
      ? 'cancel_order'
      : has('create_replacement')
        ? 'create_replacement'
        : null;

  // A status question exposes no write tool at all, so it is answered from the
  // order record alone. No policy check, nothing to gate.
  if (!action) {
    const delivered = order.deliveredAt
      ? `It was delivered on ${order.deliveredAt.slice(0, 10)}.`
      : 'It has not been delivered yet.';
    return { text: `Order ${order.id} is currently ${order.status}. ${delivered}` };
  }

  if (!called(ctx, 'search_knowledge') && has('search_knowledge')) {
    return {
      toolCalls: [
        {
          toolName: 'search_knowledge',
          input: { query: 'returns refunds cancellations policy', topic: 'returns' },
        },
      ],
    };
  }

  const knowledge = findToolResult<{ chunks?: unknown[] }>(ctx, 'search_knowledge');
  if (!knowledge || (knowledge.chunks?.length ?? 0) === 0) {
    return escalate(
      'UNSUPPORTED_SCENARIO',
      'I could not confirm the current policy, so I have not made any changes. A colleague will confirm what we can do and get back to you.',
    );
  }

  if (!called(ctx, 'check_policy') && has('check_policy')) {
    return { toolCalls: [{ toolName: 'check_policy', input: { action, orderId: order.id } }] };
  }

  const policy = findToolResult<{ decision?: string; reason?: string }>(ctx, 'check_policy');
  if (policy?.decision === 'deny') {
    return { text: `I am not able to do that for order ${order.id}. ${policy.reason}.` };
  }

  if (!called(ctx, action)) {
    return { toolCalls: [{ toolName: action, input: inputFor(action, order) }] };
  }

  const result = findToolResult<Record<string, unknown> & ToolFailure>(ctx, action);

  if (result?.awaitingApproval) {
    return {
      text: 'This one needs a quick check by a colleague before I can go ahead. I will come back to you as soon as it is approved.',
    };
  }

  if (result && result.ok === false) {
    return escalate(
      'TOOL_FAILED',
      `I was not able to complete this for order ${order.id} just now. I have not confirmed any change, and a colleague will pick it up and confirm shortly.`,
    );
  }

  if (result?.id) {
    return { text: confirmationFor(action, order, result) };
  }

  if (called(ctx, 'escalate_to_human')) {
    return { text: 'A colleague will confirm the next step with you shortly.' };
  }

  return escalate(
    'UNSUPPORTED_SCENARIO',
    'I am not able to complete this myself, so a colleague will pick it up and come back to you.',
  );
};

function inputFor(action: string, order: OrderView): Record<string, unknown> {
  const item = order.items[0];
  switch (action) {
    case 'create_refund':
      return { orderId: order.id, amountMinor: order.totalAmountMinor, reason: 'damaged' };
    case 'cancel_order':
      return { orderId: order.id, reason: 'customer_request' };
    default:
      return {
        orderId: order.id,
        items: [{ sku: item?.sku ?? 'UNKNOWN', quantity: item?.quantity ?? 1 }],
        reason: 'damaged',
      };
  }
}

function confirmationFor(
  action: string,
  order: OrderView,
  result: Record<string, unknown>,
): string {
  switch (action) {
    case 'create_refund':
      return `Thanks for letting us know. I have arranged a refund of ${money(
        Number(result.amountMinor ?? order.totalAmountMinor),
        String(result.currency ?? order.currency),
      )} for order ${order.id}. Your refund reference is ${result.id}.`;
    case 'cancel_order':
      return `Order ${order.id} has been cancelled. Your cancellation reference is ${result.id} and nothing will be shipped.`;
    default:
      return `Thanks for letting us know. I have arranged a replacement for order ${order.id}. Your replacement reference is ${result.id} and it is on its way.`;
  }
}

export const DEFAULT_PLANNERS: MockPlanner[] = [intentPlanner, agentPlanner];
