import { createHmac, timingSafeEqual } from 'node:crypto';
import { decryptSecret, type EscalationReason } from '@kora/core';

export const STRIPE_SIGNATURE_HEADER = 'stripe-signature';
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;

export const REFUND_EVENT_TYPES = ['refund.created', 'refund.updated', 'refund.failed'] as const;
export const SUBSCRIPTION_EVENT_TYPES = [
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;
export const HANDLED_EVENT_TYPES: readonly string[] = [
  ...REFUND_EVENT_TYPES,
  ...SUBSCRIPTION_EVENT_TYPES,
];

export type StripeWebhookErrorCode =
  | 'MISSING_SECRET'
  | 'MISSING_SIGNATURE'
  | 'BAD_TIMESTAMP'
  | 'NO_V1_SIGNATURE'
  | 'SIGNATURE_MISMATCH'
  | 'INVALID_EVENT';

export class StripeWebhookError extends Error {
  readonly code: StripeWebhookErrorCode;

  constructor(code: StripeWebhookErrorCode, message: string) {
    super(message);
    this.name = 'StripeWebhookError';
    this.code = code;
  }
}

export function resolveWebhookSecret(configured: string | undefined): string {
  if (!configured) {
    throw new StripeWebhookError('MISSING_SECRET', 'the stripe webhook secret is not configured');
  }
  return configured.startsWith('v1.') ? decryptSecret(configured) : configured;
}

export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = STRIPE_WEBHOOK_TOLERANCE_SECONDS,
): number {
  if (!header) {
    throw new StripeWebhookError('MISSING_SIGNATURE', 'the request carries no stripe signature');
  }
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.split('=');
    if (key === 't' && value) timestamp = Number.parseInt(value, 10);
    if (key === 'v1' && value) signatures.push(value);
  }
  if (!Number.isFinite(timestamp)) {
    throw new StripeWebhookError('BAD_TIMESTAMP', 'the stripe signature has no usable timestamp');
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new StripeWebhookError(
      'BAD_TIMESTAMP',
      'the stripe signature timestamp is outside tolerance',
    );
  }
  if (signatures.length === 0) {
    throw new StripeWebhookError('NO_V1_SIGNATURE', 'the stripe signature has no v1 signature');
  }
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
  const expectedBytes = Buffer.from(expected, 'utf8');
  const matched = signatures.some((candidate) => {
    const candidateBytes = Buffer.from(candidate, 'utf8');
    return (
      candidateBytes.length === expectedBytes.length &&
      timingSafeEqual(candidateBytes, expectedBytes)
    );
  });
  if (!matched) {
    throw new StripeWebhookError('SIGNATURE_MISMATCH', 'the stripe signature does not match');
  }
  return timestamp;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export function parseStripeEvent(rawBody: string): StripeWebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new StripeWebhookError('INVALID_EVENT', 'the webhook body is not valid json');
  }
  const event = parsed as { id?: unknown; type?: unknown; data?: { object?: unknown } };
  if (
    typeof event.id !== 'string' ||
    event.id.length === 0 ||
    typeof event.type !== 'string' ||
    event.type.length === 0 ||
    typeof event.data?.object !== 'object' ||
    event.data.object === null
  ) {
    throw new StripeWebhookError('INVALID_EVENT', 'the webhook body is not a stripe event');
  }
  return {
    id: event.id,
    type: event.type,
    data: { object: event.data.object as Record<string, unknown> },
  };
}

export type StripeEventFamily = 'refund' | 'subscription' | 'ignored';

export function stripeEventFamily(type: string): StripeEventFamily {
  if ((REFUND_EVENT_TYPES as readonly string[]).includes(type)) return 'refund';
  if ((SUBSCRIPTION_EVENT_TYPES as readonly string[]).includes(type)) return 'subscription';
  return 'ignored';
}

export interface WebhookExecutionRef {
  executionId: string;
  runId: string;
  conversationId: string;
  verified: boolean | null;
}

export interface StripeWebhookStore {
  claimEvent(event: { id: string; type: string; objectId: string }): Promise<boolean>;
  findExecution(
    toolNames: readonly string[],
    objectId: string,
  ): Promise<WebhookExecutionRef | null>;
  confirmExecution(executionId: string, observed: unknown): Promise<void>;
  recordStep(runId: string, payload: Record<string, unknown>, status?: string): Promise<void>;
  escalate(input: {
    runId: string;
    conversationId: string;
    reason: EscalationReason;
    note: string;
    context: Record<string, unknown>;
  }): Promise<void>;
}

export type StripeWebhookOutcome = 'confirmed' | 'escalated' | 'noted' | 'duplicate' | 'ignored';

export interface StripeWebhookResult {
  outcome: StripeWebhookOutcome;
  eventId: string;
  eventType: string;
}

function refundSnapshot(eventId: string, refund: Record<string, unknown>): Record<string, unknown> {
  return {
    source: 'stripe_webhook',
    eventId,
    refundId: refund.id,
    status: refund.status,
    amount: refund.amount,
    currency: refund.currency,
    chargeId: refund.charge,
  };
}

async function reconcileRefund(
  event: StripeWebhookEvent,
  store: StripeWebhookStore,
): Promise<StripeWebhookOutcome> {
  const refund = event.data.object;
  const refundId = refund.id as string;
  const status = refund.status as string | undefined;
  const execution = await store.findExecution(['create_refund'], refundId);
  if (!execution) return 'noted';
  if (status === 'succeeded') {
    await store.confirmExecution(execution.executionId, refundSnapshot(event.id, refund));
    await store.recordStep(
      execution.runId,
      { ...refundSnapshot(event.id, refund), verification: 'confirmed' },
      'ok',
    );
    return 'confirmed';
  }
  if (status === 'failed' || status === 'canceled') {
    const note = `refund ${refundId} ended as ${status}; a person needs to follow up`;
    await store.recordStep(
      execution.runId,
      { ...refundSnapshot(event.id, refund), verification: 'failed' },
      'escalated',
    );
    await store.escalate({
      runId: execution.runId,
      conversationId: execution.conversationId,
      reason: 'VERIFICATION_FAILED',
      note,
      context: refundSnapshot(event.id, refund),
    });
    return 'escalated';
  }
  await store.recordStep(
    execution.runId,
    { ...refundSnapshot(event.id, refund), verification: 'waiting' },
    'ok',
  );
  return 'noted';
}

/**
 * The billing period moved from the subscription to its items in this API version,
 * so the top-level field is absent. The stop date is the evidence the run is
 * confirmed against, so an empty one leaves the trace unable to say when it ends.
 */
function periodEndOf(subscription: Record<string, unknown>): number | null {
  const items = (
    subscription.items as { data?: Array<{ current_period_end?: unknown }> } | undefined
  )?.data;
  let latest: number | null = null;
  for (const item of items ?? []) {
    const end = item.current_period_end;
    if (typeof end === 'number' && (latest === null || end > latest)) latest = end;
  }
  if (latest !== null) return latest;
  const top = subscription.current_period_end;
  return typeof top === 'number' ? top : null;
}

async function reconcileSubscription(
  event: StripeWebhookEvent,
  store: StripeWebhookStore,
): Promise<StripeWebhookOutcome> {
  const subscription = event.data.object;
  const subscriptionId = subscription.id as string;
  const status = subscription.status as string | undefined;
  const execution = await store.findExecution(['cancel_subscription'], subscriptionId);
  if (!execution) return 'noted';
  const observed = {
    source: 'stripe_webhook',
    eventId: event.id,
    eventType: event.type,
    subscriptionId,
    status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    cancelAt: subscription.cancel_at,
    currentPeriodEnd: periodEndOf(subscription as Record<string, unknown>),
  };
  const canceled = event.type === 'customer.subscription.deleted' || status === 'canceled';
  const scheduled =
    event.type === 'customer.subscription.updated' &&
    subscription.cancel_at_period_end === true &&
    (status === 'active' || status === 'trialing');
  if (!canceled && !scheduled) {
    await store.recordStep(execution.runId, { ...observed, verification: 'waiting' }, 'ok');
    return 'noted';
  }
  await store.confirmExecution(execution.executionId, observed);
  await store.recordStep(execution.runId, { ...observed, verification: 'confirmed' }, 'ok');
  return 'confirmed';
}

export async function processStripeWebhook(input: {
  rawBody: string;
  signature: string | null;
  secret: string;
  store: StripeWebhookStore;
  toleranceSeconds?: number;
}): Promise<StripeWebhookResult> {
  verifyStripeSignature(
    input.rawBody,
    input.signature,
    input.secret,
    undefined,
    input.toleranceSeconds,
  );
  const event = parseStripeEvent(input.rawBody);
  const family = stripeEventFamily(event.type);
  if (family === 'ignored') {
    return { outcome: 'ignored', eventId: event.id, eventType: event.type };
  }
  const objectId = event.data.object.id;
  if (typeof objectId !== 'string' || objectId.length === 0) {
    throw new StripeWebhookError('INVALID_EVENT', 'the webhook event object has no id');
  }
  const claimed = await input.store.claimEvent({ id: event.id, type: event.type, objectId });
  if (!claimed) {
    return { outcome: 'duplicate', eventId: event.id, eventType: event.type };
  }
  const outcome =
    family === 'refund'
      ? await reconcileRefund(event, input.store)
      : await reconcileSubscription(event, input.store);
  return { outcome, eventId: event.id, eventType: event.type };
}
