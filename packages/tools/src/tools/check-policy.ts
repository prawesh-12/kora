import { evaluatePolicy, now } from '@kora/core';
import { withTenant } from '@kora/db';
import { z } from 'zod';
import { buildFacts } from '../facts.js';
import { defineTool } from '../registry.js';

/**
 * Advisory only. The pipeline evaluates policy again before any write, and that
 * second evaluation is the authoritative one. This tool exists so the model can
 * ask before proposing, and so the ask is visible in the trace.
 */
export const checkPolicy = defineTool({
  name: 'check_policy',
  version: 1,
  description:
    'Use this when you are about to propose an action and want to know whether the business rules allow it, deny it, or require a person to approve it.',
  inputSchema: z.object({
    action: z.string().min(1),
    orderId: z.string().optional(),
    amountMinor: z.number().int().positive().optional(),
  }),
  outputSchema: z.object({
    decision: z.enum(['allow', 'deny', 'require_approval']),
    ruleId: z.string(),
    reason: z.string(),
    policyVersion: z.string(),
    missingFacts: z.array(z.string()),
  }),
  sideEffect: 'read',
  rerunOnReplay: true,
  requiredPermission: 'policy:read',
  timeoutMs: 1000,
  maxRetries: 0,
  idempotent: true,
  inputExamples: [{ input: { action: 'create_replacement', orderId: '9832' } }],
  async execute(input, ctx) {
    const facts = buildFacts(input.action, ctx.gathered, now(), input);
    const result = evaluatePolicy(ctx.policy, facts, now());

    // Record the evaluation for the action that was asked about. Without this, a
    // run that is correctly denied leaves no policy_checks row for the action it
    // refused, and the trace cannot show why nothing happened.
    await withTenant(ctx.tenantId).policyChecks.create({
      runId: ctx.runId,
      policyKey: result.policyKey,
      policyVersion: result.policyVersion,
      ruleId: result.ruleId,
      action: input.action,
      decision: result.decision,
      reason: result.reason,
      facts: result.factsUsed,
      missingFacts: result.missingFacts,
      advisory: true,
      createdAt: now(),
    });

    return {
      decision: result.decision,
      ruleId: result.ruleId,
      reason: result.reason,
      policyVersion: result.policyVersion,
      missingFacts: result.missingFacts,
    };
  },
});
