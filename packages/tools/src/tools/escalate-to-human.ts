import { z } from 'zod';
import { defineTool } from '../registry.js';

/**
 * Terminal. The agent loop stops when this is called; the orchestrator writes the
 * escalation row and the handoff payload.
 */
export const escalateToHuman = defineTool({
  name: 'escalate_to_human',
  version: 1,
  description:
    'Use this when the customer asks for a person, when you cannot confirm the policy, or when an action failed and you cannot honestly tell the customer what happened.',
  inputSchema: z.object({
    reason: z.enum([
      'LOW_CONFIDENCE',
      'POLICY_REQUIRES_HUMAN',
      'POLICY_DENIED',
      'TOOL_FAILED',
      'VERIFICATION_FAILED',
      'CUSTOMER_REQUESTED',
      'UNSUPPORTED_SCENARIO',
      'APPROVAL_DENIED',
      'MAX_STEPS_REACHED',
    ]),
    summary: z.string().max(500).optional(),
  }),
  outputSchema: z.object({ escalated: z.literal(true), reason: z.string() }),
  sideEffect: 'write_low',
  requiredPermission: 'escalation:write',
  timeoutMs: 2000,
  maxRetries: 0,
  idempotent: true,
  terminal: true,
  inputExamples: [
    { input: { reason: 'CUSTOMER_REQUESTED' as const, summary: 'asked for a person' } },
  ],
  async execute(input) {
    return { escalated: true as const, reason: input.reason };
  },
});
