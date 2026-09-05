import { serverEnv } from '@kora/core';
import { withTenant } from '@kora/db';
import {
  StripeWebhookError,
  processStripeWebhook,
  resolveWebhookSecret,
  type StripeWebhookResult,
  type StripeWebhookStore,
} from '@kora/tools';
import { ApiError } from '@/lib/api/errors';

export function drizzleStripeWebhookStore(tenantId: string): StripeWebhookStore {
  const repos = withTenant(tenantId);
  return {
    claimEvent: (event) => repos.webhookEvents.claim(event),
    findExecution: (toolNames, objectId) =>
      repos.toolExecutions.findByProviderObjectId([...toolNames], objectId),
    confirmExecution: (executionId, observed) =>
      repos.toolExecutions.setVerification(executionId, true, observed),
    recordStep: async (runId, payload, status) => {
      const steps = await repos.steps.listForRun(runId);
      await repos.steps.create({
        runId,
        ordinal: steps.length,
        kind: 'verify',
        status: status ?? 'ok',
        payload,
      });
    },
    escalate: (input) =>
      repos.escalations
        .create({
          conversationId: input.conversationId,
          runId: input.runId,
          reason: input.reason,
          note: input.note,
          handoff: input.context,
        })
        .then(() => {}),
  };
}

export async function handleStripeWebhookRequest(
  req: Request,
  overrides?: { secret?: string; store?: StripeWebhookStore; tenantId?: string },
): Promise<StripeWebhookResult> {
  const tenantId = overrides?.tenantId ?? serverEnv().KORA_TENANT_ID;
  try {
    const secret = resolveWebhookSecret(overrides?.secret ?? serverEnv().STRIPE_WEBHOOK_SECRET);
    // Stripe signs the exact bytes posted, so the body must not be parsed and re-serialized.
    const rawBody = await req.text();
    const signature = req.headers.get('stripe-signature');
    const store = overrides?.store ?? drizzleStripeWebhookStore(tenantId);
    return await processStripeWebhook({ rawBody, signature, secret, store });
  } catch (e) {
    if (e instanceof StripeWebhookError) {
      if (e.code === 'MISSING_SECRET') {
        throw new ApiError(500, 'WEBHOOK_NOT_CONFIGURED', 'the stripe webhook is not configured');
      }
      if (e.code === 'INVALID_EVENT') throw new ApiError(400, 'INVALID_EVENT', e.message);
      throw new ApiError(400, 'INVALID_SIGNATURE', e.message);
    }
    throw e;
  }
}
