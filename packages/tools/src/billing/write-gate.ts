import type { EscalationReason, ToolErrorCode } from '@kora/core';
import { withTenant } from '@kora/db';
import { hasTenantStripeKey } from './tenant-keys.js';

export interface StripeWriteGateRequest {
  tenantId: string;
  conversationId: string;
  runId: string;
  toolName: string;
}

export interface StripeKeyStore {
  hasStripeKey(tenantId: string): Promise<boolean>;
}

export interface StripeEscalationSink {
  escalate(input: {
    tenantId: string;
    conversationId: string;
    runId: string;
    reason: EscalationReason;
    note: string;
  }): Promise<unknown>;
}

export type StripeWriteGateResult =
  | { ok: true }
  | {
      ok: false;
      outcome: { status: 'failed'; code: ToolErrorCode; error: string; retryable: boolean };
    };

export async function gateStripeWrite(
  store: StripeKeyStore,
  sink: StripeEscalationSink,
  req: StripeWriteGateRequest,
): Promise<StripeWriteGateResult> {
  if (await store.hasStripeKey(req.tenantId)) return { ok: true };
  await sink.escalate({
    tenantId: req.tenantId,
    conversationId: req.conversationId,
    runId: req.runId,
    reason: 'TOOL_FAILED',
    note: `${req.toolName} cannot run because this tenant has no Stripe key configured`,
  });
  return {
    ok: false,
    outcome: {
      status: 'failed',
      code: 'CONFIG_ERROR',
      error: `${req.toolName} cannot run because this tenant has no Stripe key configured`,
      retryable: false,
    },
  };
}

export function gateTenantStripeWrite(req: StripeWriteGateRequest): Promise<StripeWriteGateResult> {
  const repos = withTenant(req.tenantId);
  return gateStripeWrite(
    { hasStripeKey: (tenantId) => hasTenantStripeKey(tenantId) },
    {
      escalate: (input) =>
        repos.escalations.create({
          conversationId: input.conversationId,
          runId: input.runId,
          reason: input.reason,
          note: input.note,
        }),
    },
    req,
  );
}
