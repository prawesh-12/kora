import type { AssembledTrace } from '@kora/db';
import type { EvaluationInput, ExternalStateSnapshot } from '../src/types.js';

const AT = new Date('2026-08-27T12:00:00.000Z');

type Deep<T> = { [K in keyof T]?: T[K] extends object ? Deep<T[K]> : T[K] };

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run_1',
    tenantId: 'ten_acme',
    conversationId: 'conv_1',
    traceId: 'tr_1',
    agentConfigVersion: 'cfg',
    triggerMessageId: 'msg_1',
    startedAt: AT,
    finishedAt: AT,
    durationMs: 1000,
    stepCount: 5,
    intent: 'DAMAGED_ORDER',
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
    tenantId: 'ten_acme',
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
    tenantId: 'ten_acme',
    runId: 'run_1',
    stepId: 'stp_1',
    toolName: 'create_replacement',
    toolVersion: 1,
    input: { orderId: '9832' },
    output: { id: 'REP-0001', orderId: '9832' },
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
    tenantId: 'ten_acme',
    runId: 'run_1',
    stepId: 'stp_1',
    policyKey: 'acme_damaged_order',
    policyVersion: '1.0.0',
    ruleId: 'standard_replacement',
    action: 'create_replacement',
    decision: 'allow',
    reason: 'within policy',
    facts: {},
    missingFacts: [] as string[],
    createdAt: AT,
    ...overrides,
  };
}

export function snapshot(replacements: number, orderId = '9832'): ExternalStateSnapshot {
  return {
    orders: {},
    replacementsByOrder: {
      [orderId]: Array.from({ length: replacements }, (_, i) => ({
        id: `REP-000${i + 1}`,
        orderId,
        status: 'created' as const,
        createdAt: AT.toISOString(),
        estimatedDeliveryDays: 5,
      })),
    },
    refundsByOrder: { [orderId]: [] },
    cancellationsByOrder: { [orderId]: [] },
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
        message('customer', 'My coffee machine from order 9832 arrived broken.'),
        message('agent', 'I have arranged a replacement for order 9832. Reference REP-0001.'),
      ],
    },
    steps: [],
    toolExecutions: [
      toolExecution({
        id: 'tex_0',
        toolName: 'get_order',
        input: { orderId: '9832' },
        output: {
          id: '9832',
          customerId: 'cus_014',
          status: 'delivered',
          items: [
            {
              sku: 'SKU-CM-01',
              name: 'Coffee machine',
              category: 'appliance',
              quantity: 1,
              unitAmountMinor: 349900,
            },
          ],
          totalAmountMinor: 349900,
          currency: 'INR',
          placedAt: AT.toISOString(),
          deliveredAt: AT.toISOString(),
          replacementIds: [],
          refundIds: [],
          refundedAmountMinor: 0,
          cancellationIds: [],
        },
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
        query: 'damaged item replacement',
        filters: { topic: 'returns' },
        chunks: [
          {
            chunkId: 'chk_1',
            documentId: 'doc_1',
            documentVersion: 1,
            title: 'Acme Store damaged item policy',
            headingPath: 'Damaged items > Eligibility',
            content: 'Replacements are available for 7 days from delivery.',
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
