import type { Intent } from '@kora/core';
import type { MockPlanner, MockPlannerContext } from './language-model.js';

export const ORDER_REF = /\b(\d{4,})\b/;

const SUBSCRIPTION_REF = /\b((?:sub|in|re|price)_[A-Za-z0-9]+)\b/;

export const HUMAN_PHRASES = [
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

const CANCEL_PHRASES = [
  'cancel',
  'call it off',
  'stop my subscription',
  'end my subscription',
  'do not renew',
  "don't renew",
  'stop charging me',
  'turn off auto-renew',
  'no longer need',
];

const REFUND_PHRASES = ['refund', 'money back', 'reimburse', 'pay me back', 'charge back'];

const CHANGE_PHRASES = [
  'change my plan',
  'change plan',
  'switch plan',
  'switch to',
  'upgrade',
  'downgrade',
  'move to',
  'cheaper plan',
  'different plan',
];

const BILLING_PHRASES: Array<string | RegExp> = [
  'why was i charged',
  'charged twice',
  'what is this charge',
  'invoice',
  'receipt',
  'billing',
  'how much',
  'when will i be charged',
  'card was charged',
  'explain my bill',
];

const HUMAN_WEIGHT = 3;

type Pattern = string | RegExp;

export function scoreIntents(text: string): Array<{ intent: Intent; hits: number }> {
  const count = (patterns: Pattern[]) =>
    patterns.filter((p) => (typeof p === 'string' ? text.includes(p) : p.test(text))).length;
  return [
    { intent: 'HUMAN_REQUEST' as Intent, hits: count(HUMAN_PHRASES) * HUMAN_WEIGHT },
    { intent: 'CANCEL_SUBSCRIPTION' as Intent, hits: count(CANCEL_PHRASES) },
    { intent: 'REFUND_REQUEST' as Intent, hits: count(REFUND_PHRASES) },
    { intent: 'CHANGE_PLAN' as Intent, hits: count(CHANGE_PHRASES) },
    { intent: 'BILLING_QUESTION' as Intent, hits: count(BILLING_PHRASES) },
  ].sort((a, b) => b.hits - a.hits);
}

function resolveTie(top: Intent, second: Intent): Intent {
  const writeCapable: Intent[] = ['CANCEL_SUBSCRIPTION', 'REFUND_REQUEST', 'CHANGE_PLAN'];
  if (writeCapable.includes(second) && !writeCapable.includes(top)) return second;
  return top;
}

function lastCustomerTurn(ctx: MockPlannerContext): string {
  const lines = ctx.customerText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('Customer:'))
    .map((l) => l.slice('Customer:'.length).trim());
  return (lines.at(-1) ?? ctx.customerText).toLowerCase();
}

export const intentPlanner: MockPlanner = (ctx) => {
  if (ctx.options.responseFormat?.type !== 'json') return undefined;

  const text = lastCustomerTurn(ctx);
  const subscriptionReference =
    text.match(SUBSCRIPTION_REF)?.[1] ?? text.match(ORDER_REF)?.[1] ?? null;
  const scored = scoreIntents(text);
  const top = scored[0]!;
  const second = scored[1]!;

  const emit = (intent: Intent, confidence: number, evidence: string) => ({
    text: JSON.stringify({
      intent,
      confidence: Number(confidence.toFixed(2)),
      subscriptionReference,
      evidence: evidence.slice(0, 200),
    }),
  });

  if (top.hits === 0) {
    return emit('OUT_OF_SCOPE', 0.55, 'no supported workflow matches this request');
  }

  if (top.intent === 'HUMAN_REQUEST') {
    return emit('HUMAN_REQUEST', 0.97, 'the customer asked to be put through to a person');
  }

  const contested = second.hits === top.hits && second.hits > 0;
  if (contested) {
    const chosen = resolveTie(top.intent, second.intent);
    return emit(chosen, 0.62, `both ${top.intent} and ${second.intent} apply; chose ${chosen}`);
  }

  const confidence = subscriptionReference ? 0.94 : 0.78;
  return emit(
    top.intent,
    confidence,
    subscriptionReference
      ? `the customer names ${subscriptionReference} and asks for ${top.intent}`
      : `the request matches ${top.intent} but names no subscription`,
  );
};
