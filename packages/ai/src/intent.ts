import { type Intent, type ModelError, type Result, ValidationError, err, ok } from '@kora/core';
import type { MessageRow, RunHandle } from '@kora/db';
import { Output, generateText } from 'ai';
import { z } from 'zod';
import { callModel } from './gateway.js';
import { INTENT_SYSTEM_PROMPT, buildIntentPrompt } from './prompts/intent.js';

const RECENT_MESSAGES = 6;

const intentSchema = z.object({
  intent: z.enum([
    'ORDER_STATUS',
    'DAMAGED_ORDER',
    'CANCEL_ORDER',
    'REFUND_REQUEST',
    'HUMAN_REQUEST',
    'OUT_OF_SCOPE',
  ]),
  confidence: z.number().min(0).max(1),
  orderReference: z.string().nullable(),
  evidence: z.string().max(200),
});

export interface IntentResult {
  intent: Intent;
  confidence: number;
  orderReference: string | null;
  evidence: string;
  belowThreshold: boolean;
}

export async function detectIntent(args: {
  tenantId: string;
  messages: MessageRow[];
  threshold: number;
  run: RunHandle;
}): Promise<Result<IntentResult, ModelError | ValidationError>> {
  if (args.messages.length === 0) {
    return err(
      new ValidationError('intent detection needs at least one message', {
        code: 'EMPTY_CONVERSATION',
      }),
    );
  }

  // Intent is about what the customer wants now, not the whole history.
  const recent = args.messages.slice(-RECENT_MESSAGES);

  const startedAt = Date.now();
  const result = await callModel({
    purpose: 'classifier',
    tenantId: args.tenantId,
    run: { tenantId: args.tenantId, runId: args.run.runId, traceId: args.run.traceId },
    timeoutMs: 4000,
    fn: (model, signal) =>
      generateText({
        model,
        temperature: 0,
        abortSignal: signal,
        output: Output.object({ schema: intentSchema }),
        system: INTENT_SYSTEM_PROMPT,
        prompt: buildIntentPrompt(recent),
      }),
  });

  if (!result.ok) {
    await args.run.record('intent', { error: result.error.code }, 'failed');
    return err(result.error);
  }

  const classifiedInMs = Date.now() - startedAt;
  const parsed = intentSchema.safeParse(result.value.output);
  if (!parsed.success) {
    await args.run.record('intent', { error: 'MALFORMED_INTENT' }, 'failed');
    return err(
      new ValidationError('the classifier returned a shape that does not match the schema', {
        code: 'MALFORMED_INTENT',
        context: { issues: parsed.error.issues },
      }),
    );
  }

  const belowThreshold = parsed.data.confidence < args.threshold;
  const intentResult: IntentResult = { ...parsed.data, belowThreshold };

  await args.run.record(
    'intent',
    { ...intentResult, threshold: args.threshold },
    'ok',
    classifiedInMs,
  );
  return ok(intentResult);
}
