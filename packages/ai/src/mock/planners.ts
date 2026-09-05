import { HUMAN_PHRASES, intentPlanner } from './intent-planner.js';
import type { MockPlanner, MockPlannerContext, MockTurn } from './language-model.js';

export { intentPlanner };

const SUBSCRIPTION_REF = /\b((?:sub|in|re|price|prod|pi|ch|cus|si)_[A-Za-z0-9]+)\b/;

interface SubscriptionView {
  id: string;
  status: string;
  customerId: string;
  latestInvoiceId: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number | null;
  items: Array<{ subscriptionItemId: string; priceId: string }>;
}

interface InvoiceView {
  id: string;
  status: string;
  amountPaid: { amountMinor: number; currency: string };
}

interface WriteResult {
  ok?: false;
  awaitingApproval?: boolean;
  refundId?: string;
  status?: string;
  amountMinor?: number;
  currency?: string;
  id?: string;
  subscription?: { id: string };
  quotedNextChargeMinor?: number;
}

function findToolResult<T>(ctx: MockPlannerContext, toolName: string): T | null {
  for (let i = ctx.toolResults.length - 1; i >= 0; i--) {
    const r = ctx.toolResults[i];
    if (r && r.toolName === toolName) return r.output as T;
  }
  return null;
}

function called(ctx: MockPlannerContext, name: string): boolean {
  return ctx.calledTools.includes(name);
}

function major(amountMinor: number): string {
  return (amountMinor / 100).toLocaleString('en-IN');
}

function requestedAmountMinor(text: string): number | null {
  const match = text.match(/inr\s?([\d,]+)/);
  if (!match) return null;
  const major = Number((match[1] ?? '').replace(/,/g, ''));
  if (!Number.isFinite(major) || major <= 0) return null;
  return Math.round(major * 100);
}

export const agentPlanner: MockPlanner = (ctx): MockTurn | undefined => {
  if (ctx.options.responseFormat?.type === 'json') return undefined;

  const has = (name: string) => ctx.availableTools.includes(name);
  const text = ctx.customerText.toLowerCase();
  const ref = text.match(SUBSCRIPTION_REF)?.[1];

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

  if (!ref) {
    return escalate(
      'UNSUPPORTED_SCENARIO',
      'I could not find a subscription reference in your message, so I have asked a colleague to pick this up.',
    );
  }

  const subscriptionId = ref.startsWith('in_') ? null : ref;

  if (subscriptionId && !called(ctx, 'get_subscription') && has('get_subscription')) {
    return { toolCalls: [{ toolName: 'get_subscription', input: { subscriptionId } }] };
  }

  const subscription = findToolResult<SubscriptionView>(ctx, 'get_subscription');
  if (subscriptionId && !subscription?.id) {
    return escalate(
      'TOOL_FAILED',
      `I could not look up subscription ${subscriptionId} just now, so I have asked a colleague to check it. I have not made any changes.`,
    );
  }

  const invoiceId = ref.startsWith('in_') ? ref : (subscription?.latestInvoiceId ?? null);
  if (invoiceId && !called(ctx, 'get_invoice') && has('get_invoice')) {
    return { toolCalls: [{ toolName: 'get_invoice', input: { invoiceId } }] };
  }
  const invoice = findToolResult<InvoiceView>(ctx, 'get_invoice');

  const action = has('create_refund')
    ? 'create_refund'
    : has('cancel_subscription')
      ? 'cancel_subscription'
      : has('change_plan')
        ? 'change_plan'
        : null;

  if (!action) {
    if (subscription && invoice) {
      return {
        text: `Subscription ${subscription.id} is currently ${subscription.status}. The latest invoice ${invoice.id} shows ${invoice.amountPaid.currency} ${major(invoice.amountPaid.amountMinor)} paid.`,
      };
    }
    return escalate(
      'TOOL_FAILED',
      'I could not pull up the billing records just now, so a colleague will confirm the details shortly.',
    );
  }

  const requested = requestedAmountMinor(text);

  const subscriptionItemId = subscription?.items?.[0]?.subscriptionItemId ?? null;
  const currentPriceId = subscription?.items?.[0]?.priceId ?? null;
  const targetPriceId =
    currentPriceId === 'price_basic' ? 'price_pro' : currentPriceId ? 'price_basic' : null;

  if (action === 'change_plan' && subscription && subscriptionItemId && targetPriceId) {
    if (!called(ctx, 'preview_change') && has('preview_change')) {
      return {
        toolCalls: [
          {
            toolName: 'preview_change',
            input: {
              subscriptionId: subscription.id,
              subscriptionItemId,
              targetPriceId,
              prorationBehavior: 'create_prorations' as const,
            },
          },
        ],
      };
    }
  }

  if (!called(ctx, 'search_knowledge') && has('search_knowledge')) {
    return {
      toolCalls: [
        {
          toolName: 'search_knowledge',
          input: { query: 'subscription refunds cancellations billing policy', topic: 'refunds' },
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

  const writeInput =
    action === 'create_refund'
      ? {
          subscriptionId: subscription?.id ?? subscriptionId ?? ref,
          ...(invoice ? { invoiceId: invoice.id } : {}),
          amountMinor: requested ?? invoice?.amountPaid.amountMinor ?? 0,
          reason: 'requested_by_customer' as const,
        }
      : action === 'change_plan' && subscriptionItemId && targetPriceId
        ? {
            subscriptionId: subscription?.id ?? subscriptionId ?? ref,
            subscriptionItemId,
            targetPriceId,
            prorationBehavior: 'create_prorations' as const,
          }
        : {
            subscriptionId: subscription?.id ?? subscriptionId ?? ref,
            mode: 'at_period_end' as const,
          };

  if (!called(ctx, 'check_policy') && has('check_policy')) {
    return {
      toolCalls: [
        {
          toolName: 'check_policy',
          input: {
            action,
            ...(typeof writeInput.subscriptionId === 'string'
              ? { subscriptionId: writeInput.subscriptionId }
              : {}),
            ...(action === 'create_refund' && (requested ?? invoice)
              ? { amountMinor: requested ?? invoice!.amountPaid.amountMinor }
              : {}),
          },
        },
      ],
    };
  }

  const policy = findToolResult<{ decision?: string; reason?: string }>(ctx, 'check_policy');
  if (policy?.decision === 'deny') {
    return {
      text: `I am not able to refund that amount for subscription ${subscription?.id ?? ref}. ${policy.reason ?? 'The policy does not allow it.'} A colleague can review this with you.`,
    };
  }

  if (!called(ctx, action)) {
    return { toolCalls: [{ toolName: action, input: writeInput }] };
  }

  const result = findToolResult<WriteResult>(ctx, action);

  if (result?.awaitingApproval) {
    return {
      text: 'This one needs a quick check by a colleague before I can go ahead. I will come back to you as soon as it is approved.',
    };
  }

  if (result && result.ok === false) {
    return escalate(
      'TOOL_FAILED',
      `I was not able to complete this for subscription ${subscription?.id ?? ref} just now. I have not confirmed any change, and a colleague will pick it up and confirm shortly.`,
    );
  }

  if (action === 'create_refund' && result?.refundId) {
    if (result.status !== 'succeeded') {
      return escalate(
        'REFUND_PENDING',
        `The refund for subscription ${subscription?.id ?? ref} is waiting on the payment provider. I have not confirmed it yet, and a colleague will confirm it with you as soon as it lands.`,
      );
    }
    return {
      text: `I have arranged a refund of ${result.currency ?? invoice?.amountPaid.currency ?? 'INR'} ${major(result.amountMinor ?? invoice?.amountPaid.amountMinor ?? 0)} for subscription ${subscription?.id ?? ref}. Your refund reference is ${result.refundId}.`,
    };
  }

  if (action === 'change_plan' && result?.subscription) {
    return {
      text: `Subscription ${result.subscription.id} is now on the cheaper plan. The prorated amount is ${invoice?.amountPaid.currency ?? 'INR'} ${major(result.quotedNextChargeMinor ?? 0)}.`,
    };
  }

  if (action === 'cancel_subscription' && result?.id) {
    const end = subscription?.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd * 1000).toISOString().slice(0, 10)
      : 'the end of the current period';
    return {
      text: `Subscription ${result.id} will stay active until ${end} and then end. Nothing further will be charged.`,
    };
  }

  if (called(ctx, 'escalate_to_human')) {
    return { text: 'A colleague will confirm the next step with you shortly.' };
  }

  return escalate(
    'UNSUPPORTED_SCENARIO',
    'I am not able to complete this myself, so a colleague will pick it up and come back to you.',
  );
};

export const DEFAULT_PLANNERS: MockPlanner[] = [intentPlanner, agentPlanner];
