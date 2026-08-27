import type { MockPlanner, MockPlannerContext, MockTurn } from './language-model.js';

const ORDER_REF = /\b(\d{4,})\b/;

const HUMAN_PHRASES = [
  'talk to a human',
  'talk to a person',
  'speak to a human',
  'speak to a person',
  'real person',
  'human agent',
  'put me through',
  "don't want to talk to a bot",
  'do not want to talk to a bot',
  'not a bot',
  'agent please',
];

const DAMAGE_PHRASES = [
  'broken',
  'damaged',
  'smashed',
  'cracked',
  'shattered',
  'arrived broken',
  'came smashed',
  'faulty',
  'defective',
];

function lastCustomerTurn(ctx: MockPlannerContext): string {
  const lines = ctx.customerText.split('\n').filter(Boolean);
  return (lines.at(-1) ?? ctx.customerText).toLowerCase();
}

/**
 * The classifier. Recognised by the JSON response format the intent step asks for.
 */
export const intentPlanner: MockPlanner = (ctx) => {
  if (ctx.options.responseFormat?.type !== 'json') return undefined;

  const text = lastCustomerTurn(ctx);
  const orderReference = text.match(ORDER_REF)?.[1] ?? null;

  const wantsHuman = HUMAN_PHRASES.some((p) => text.includes(p));
  const damaged = DAMAGE_PHRASES.some((p) => text.includes(p));

  if (wantsHuman) {
    return {
      text: JSON.stringify({
        intent: 'HUMAN_REQUEST',
        confidence: 0.97,
        orderReference,
        evidence: 'the customer asked to be put through to a person',
      }),
    };
  }

  if (damaged && orderReference) {
    return {
      text: JSON.stringify({
        intent: 'DAMAGED_ORDER',
        confidence: 0.94,
        orderReference,
        evidence: 'the customer reports a damaged item on a specific order',
      }),
    };
  }

  if (damaged) {
    return {
      text: JSON.stringify({
        intent: 'DAMAGED_ORDER',
        confidence: 0.62,
        orderReference: null,
        evidence: 'damage is mentioned but no order is identified',
      }),
    };
  }

  return {
    text: JSON.stringify({
      intent: 'OUT_OF_SCOPE',
      confidence: 0.55,
      orderReference,
      evidence: 'the request does not match a supported workflow',
    }),
  };
};

interface OrderView {
  id: string;
  status: string;
  items: Array<{ sku: string; category: string; quantity: number; unitAmountMinor: number }>;
  totalAmountMinor: number;
  deliveredAt: string | null;
  replacementIds: string[];
}

function findToolResult<T>(ctx: MockPlannerContext, toolName: string): T | null {
  for (let i = ctx.toolResults.length - 1; i >= 0; i--) {
    const r = ctx.toolResults[i];
    if (r && r.toolName === toolName) return r.output as T;
  }
  return null;
}

function isFailure(output: unknown): boolean {
  return Boolean(output && typeof output === 'object' && (output as { ok?: boolean }).ok === false);
}

function called(ctx: MockPlannerContext, name: string): boolean {
  return ctx.calledTools.includes(name);
}

/**
 * The agent loop. Walks the damaged-order workflow one tool at a time, reacting to
 * what the previous tool actually returned. It never invents an id or an amount:
 * every fact in the final message comes out of a tool result.
 */
export const agentPlanner: MockPlanner = (ctx): MockTurn | undefined => {
  if (ctx.options.responseFormat?.type === 'json') return undefined;

  const has = (name: string) => ctx.availableTools.includes(name);
  const text = ctx.customerText.toLowerCase();
  const orderId = text.match(ORDER_REF)?.[1];

  const escalate = (reason: string): MockTurn => ({
    toolCalls: [{ toolName: 'escalate_to_human', input: { reason, summary: reason } }],
  });

  if (HUMAN_PHRASES.some((p) => text.includes(p))) {
    return called(ctx, 'escalate_to_human')
      ? { text: 'I have passed this to a colleague. Someone will be with you shortly.' }
      : escalate('CUSTOMER_REQUESTED');
  }

  if (!orderId) {
    return called(ctx, 'escalate_to_human')
      ? { text: 'A colleague will follow up with you shortly.' }
      : escalate('UNSUPPORTED_SCENARIO');
  }

  if (!called(ctx, 'get_order') && has('get_order')) {
    return { toolCalls: [{ toolName: 'get_order', input: { orderId } }] };
  }

  const order = findToolResult<OrderView | { ok: false }>(ctx, 'get_order');
  if (!order || isFailure(order)) {
    return called(ctx, 'escalate_to_human')
      ? {
          text: `I could not find order ${orderId} on your account, so I have asked a colleague to look into it. I have not made any changes.`,
        }
      : escalate('TOOL_FAILED');
  }
  const found = order as OrderView;

  if (!called(ctx, 'search_knowledge') && has('search_knowledge')) {
    return {
      toolCalls: [
        {
          toolName: 'search_knowledge',
          input: { query: 'damaged item replacement policy', topic: 'returns' },
        },
      ],
    };
  }

  const knowledge = findToolResult<{ chunks?: unknown[] }>(ctx, 'search_knowledge');
  const knowledgeEmpty = !knowledge || (knowledge.chunks?.length ?? 0) === 0;
  if (knowledgeEmpty) {
    return called(ctx, 'escalate_to_human')
      ? {
          text: 'I could not confirm the current replacement policy, so I have not made any changes. A colleague will confirm what we can do and get back to you.',
        }
      : escalate('UNSUPPORTED_SCENARIO');
  }

  if (!called(ctx, 'check_policy') && has('check_policy')) {
    return {
      toolCalls: [
        { toolName: 'check_policy', input: { action: 'create_replacement', orderId: found.id } },
      ],
    };
  }

  const policy = findToolResult<{ decision?: string; reason?: string }>(ctx, 'check_policy');

  if (policy?.decision === 'deny') {
    return { text: `I am not able to arrange a replacement for order ${found.id}. ${policy.reason}.` };
  }

  if (!called(ctx, 'create_replacement') && has('create_replacement')) {
    const item = found.items[0];
    return {
      toolCalls: [
        {
          toolName: 'create_replacement',
          input: {
            orderId: found.id,
            items: [{ sku: item?.sku ?? 'UNKNOWN', quantity: item?.quantity ?? 1 }],
            reason: 'damaged',
          },
        },
      ],
    };
  }

  const replacement = findToolResult<{ id?: string; ok?: boolean; reason?: string }>(
    ctx,
    'create_replacement',
  );

  if (replacement && replacement.ok === false) {
    return called(ctx, 'escalate_to_human')
      ? {
          text: `I was not able to complete the replacement for order ${found.id} just now. I have not confirmed any change, and a colleague will pick this up and confirm shortly.`,
        }
      : escalate('TOOL_FAILED');
  }

  if (replacement?.id) {
    return {
      text: `Thanks for letting us know. I have arranged a replacement for order ${found.id}. Your replacement reference is ${replacement.id} and it is on its way.`,
    };
  }

  if (called(ctx, 'escalate_to_human')) {
    return { text: 'A colleague will confirm the next step with you shortly.' };
  }

  return escalate('UNSUPPORTED_SCENARIO');
};

export const DEFAULT_PLANNERS: MockPlanner[] = [intentPlanner, agentPlanner];
