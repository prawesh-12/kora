import type { AssembledTrace } from '@kora/db';
import type { RefundRecord, SubscriptionRecord } from '../src/deps.js';
import type { EvaluationInput, ExternalStateSnapshot } from '../src/types.js';

const AT = new Date('2026-08-27T12:00:00.000Z');
const AMOUNT_MINOR = 349900;

type Deep<T> = { [K in keyof T]?: T[K] extends object ? Deep<T[K]> : T[K] };

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run_1',
    tenantId: 'ten_kora',
    conversationId: 'conv_1',
    traceId: 'tr_1',
    agentConfigVersion: 'cfg',
    triggerMessageId: 'msg_1',
    startedAt: AT,
    finishedAt: AT,
    durationMs: 1000,
    stepCount: 5,
    intent: 'REFUND_REQUEST',
    intentConfidence: 0.94,
    outcome: 'resolved_automatically',
    finalState: 'RESOLVED',
    errorCode: null,
    tokenInput: 100,
    tokenOutput: 20,
    costUsdMicros: 100,
    ...overrides,
  };
}

function message(role: string, content: string) {
  return {
    id: `msg_${role}`,
    tenantId: 'ten_kora',
    conversationId: 'conv_1',
    role,
    content,
    parts: [],
    createdAt: AT,
  };
}

export function toolExecution(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tex_1',
    tenantId: 'ten_kora',
    runId: 'run_1',
    stepId: 'stp_1',
    toolName: 'create_refund',
    toolVersion: 1,
    input: {
      subscriptionId: 'sub_1S',
      invoiceId: 'in_1S',
      amountMinor: AMOUNT_MINOR,
      reason: 'requested_by_customer',
    },
    output: {
      refundId: 're_1S',
      status: 'succeeded',
      amountMinor: AMOUNT_MINOR,
      currency: 'INR',
    },
    status: 'ok',
    verified: true,
    verifyObserved: { ok: true },
    idempotencyKey: 'idm_1',
    attempt: 1,
    durationMs: 100,
    errorCode: null,
    errorMessage: null,
    startedAt: AT,
    finishedAt: AT,
    ...overrides,
  };
}

export function policyCheck(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pck_1',
    tenantId: 'ten_kora',
    runId: 'run_1',
    stepId: 'stp_1',
    policyKey: 'kora_refund',
    policyVersion: '1.0.0',
    ruleId: 'refund_standard',
    action: 'create_refund',
    decision: 'allow',
    reason: 'within policy',
    facts: {},
    missingFacts: [] as string[],
    createdAt: AT,
    ...overrides,
  };
}

function subscriptionRecord(id: string): SubscriptionRecord {
  return {
    id,
    status: 'active',
    customerId: 'cus_014',
    items: [
      {
        subscriptionItemId: 'si_1S',
        priceId: 'price_basic',
        productId: 'prod_basic',
        unitAmount: { amountMinor: AMOUNT_MINOR, currency: 'INR' },
        quantity: 1,
      },
    ],
    currentPeriodEnd: 1_800_000_000,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    cancelAt: null,
    latestInvoiceId: 'in_1S',
    collectionMethod: 'charge_automatically',
  };
}

function refundRecord(id: string): RefundRecord {
  return {
    id,
    status: 'succeeded',
    amount: { amountMinor: AMOUNT_MINOR, currency: 'INR' },
    chargeId: 'ch_1S',
    paymentIntentId: 'pi_1S',
    reason: 'requested_by_customer',
    created: 1_790_000_000,
  };
}

/** The business system holding `refunds` refunds against the seeded subscription. */
export function snapshot(refunds: number, subscriptionId = 'sub_1S'): ExternalStateSnapshot {
  return {
    refunds: Object.fromEntries(
      Array.from({ length: refunds }, (_, i) => [`re_${i + 1}S`, refundRecord(`re_${i + 1}S`)]),
    ),
    subscriptions: { [subscriptionId]: subscriptionRecord(subscriptionId) },
    fetchedAt: AT,
  };
}

/** A fully passing run: allowed, written, verified, grounded, no escalation. */
export function passingInput(overrides: Deep<EvaluationInput> = {}): EvaluationInput {
  const trace = {
    run: run(),
    conversation: {
      row: {},
      messages: [
        message('customer', 'Please refund my last payment on subscription sub_1S.'),
        message('agent', 'I have refunded INR 3,499. The refund reference is re_1S.'),
      ],
    },
    steps: [],
    toolExecutions: [
      toolExecution({
        id: 'tex_0',
        toolName: 'get_subscription',
        input: { subscriptionId: 'sub_1S' },
        output: subscriptionRecord('sub_1S'),
        verified: null,
        verifyObserved: null,
      }),
      toolExecution(),
    ],
    policyChecks: [policyCheck()],
    approvals: [],
    escalation: null,
    llmCalls: [],
    retrievals: [
      {
        stepId: 'stp_r',
        query: 'refund window',
        filters: { topic: 'refunds' },
        chunks: [
          {
            chunkId: 'chk_1',
            documentId: 'doc_1',
            documentVersion: 1,
            title: 'Refund policy',
            headingPath: 'Refunds > Eligibility',
            content: 'Refunds are available for 30 days from the payment date.',
            distance: 0.12,
          },
        ],
      },
    ],
    totals: { durationMs: 1000, tokensIn: 100, tokensOut: 20, costUsdMicros: 100 },
  } as unknown as AssembledTrace;

  return {
    trace,
    externalState: snapshot(1),
    ...overrides,
  } as EvaluationInput;
}

export function withTrace(patch: Record<string, unknown>): EvaluationInput {
  const input = passingInput();
  return { ...input, trace: { ...input.trace, ...patch } as AssembledTrace };
}
