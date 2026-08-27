import type { Intent } from '@kora/core';
import type { MockPlanner, MockPlannerContext } from './language-model.js';

export const ORDER_REF = /\b(\d{4,})\b/;

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

// No phrase may be a substring of another in the same list, or one message
// scores twice for saying one thing and beats a genuinely competing intent.
const DAMAGE_PHRASES = [
  'broken',
  'damaged',
  'smashed',
  'cracked',
  'shattered',
  'faulty',
  'defective',
  'missing item',
  'wrong item',
  'replacement',
  'replace it',
  'destroyed',
  'send me a new',
  'send a new',
  'new one',
];

const REFUND_PHRASES = ['refund', 'money back', 'reimburse', 'pay me back', 'charge back'];

const CANCEL_PHRASES = [
  'cancel',
  'call it off',
  'stop the order',
  'do not ship',
  "don't ship",
  'no longer want',
];

const HUMAN_WEIGHT = 3;

// Phrases here must not assume the customer says "it": "has order 9834 shipped"
// and "has it shipped" are the same question.
const STATUS_PHRASES: Array<string | RegExp> = [
  'where is',
  "where's",
  'track',
  'delivery date',
  // A word boundary, not a substring: "arrive" is a question about the future,
  // "arrived" is a delivery that already happened and usually precedes a damage
  // report. A substring match cannot tell them apart.
  /\barrive\b/,
  /\barriving\b/,
  'shipped',
  'status of',
  'any update',
];

/**
 * The offline classifier. Recognised by the JSON response format the intent step
 * asks for, which no other model call uses.
 *
 * The scoring is deliberately crude: it exists to make the workflow deterministic,
 * not to be a good classifier. What it does have to get right is the confidence,
 * because a genuinely ambiguous message must land below the threshold rather than
 * guessing.
 */
type Pattern = string | RegExp;

export function scoreIntents(text: string): Array<{ intent: Intent; hits: number }> {
  const count = (patterns: Pattern[]) =>
    patterns.filter((p) => (typeof p === 'string' ? text.includes(p) : p.test(text))).length;
  return [
    { intent: 'HUMAN_REQUEST' as Intent, hits: count(HUMAN_PHRASES) * HUMAN_WEIGHT },
    { intent: 'DAMAGED_ORDER' as Intent, hits: count(DAMAGE_PHRASES) },
    { intent: 'REFUND_REQUEST' as Intent, hits: count(REFUND_PHRASES) },
    { intent: 'CANCEL_ORDER' as Intent, hits: count(CANCEL_PHRASES) },
    { intent: 'ORDER_STATUS' as Intent, hits: count(STATUS_PHRASES) },
  ].sort((a, b) => b.hits - a.hits);
}

/** Damage plus a refund ask means refund: the customer named the remedy they want. */
function resolveTie(top: Intent, second: Intent): Intent {
  if (top === 'DAMAGED_ORDER' && second === 'REFUND_REQUEST') return 'REFUND_REQUEST';
  if (top === 'REFUND_REQUEST' && second === 'DAMAGED_ORDER') return 'REFUND_REQUEST';
  // Otherwise prefer the one that can lead to a write, so policy gets to check it.
  const writeCapable: Intent[] = ['REFUND_REQUEST', 'CANCEL_ORDER', 'DAMAGED_ORDER'];
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
  const orderReference = text.match(ORDER_REF)?.[1] ?? null;
  const scored = scoreIntents(text);
  const top = scored[0]!;
  const second = scored[1]!;

  const emit = (intent: Intent, confidence: number, evidence: string) => ({
    text: JSON.stringify({
      intent,
      confidence: Number(confidence.toFixed(2)),
      orderReference,
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
    // A real tie between two unrelated intents is ambiguous and must not be guessed.
    const related =
      chosen === 'REFUND_REQUEST' &&
      [top.intent, second.intent].every((i) => i === 'DAMAGED_ORDER' || i === 'REFUND_REQUEST');
    return emit(
      chosen,
      related ? 0.88 : 0.62,
      `both ${top.intent} and ${second.intent} apply; chose ${chosen}`,
    );
  }

  const confidence = orderReference ? 0.94 : 0.78;
  return emit(
    top.intent,
    confidence,
    orderReference
      ? `the customer names order ${orderReference} and asks for ${top.intent}`
      : `the request matches ${top.intent} but names no order`,
  );
};
