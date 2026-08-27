import { z } from 'zod';

const verdict = z.enum(['MET', 'UNMET', 'CANNOT_ASSESS']);

export const scenarioSchema = z
  .object({
    id: z.string().regex(/^[A-Z]+\d+$/),
    name: z.string().regex(/^[a-z0-9_]+$/),
    category: z
      .string()
      .regex(/^[a-z0-9_]+$/)
      .optional(),
    input: z.string().min(1),
    /** Extra customer turns, sent in order after the first. */
    followUps: z.array(z.string()).default([]),
    seed: z.object({ orderId: z.string().optional(), customerId: z.string().optional() }).strict(),
    faults: z
      .array(
        z
          .object({
            onTool: z.string(),
            fault: z.enum(['timeout', '500', 'slow', 'malformed', 'duplicate', 'stale']),
            times: z.number().int().positive().optional(),
          })
          .strict(),
      )
      .default([]),
    emptyKnowledge: z.boolean().optional(),
    repeatTurn: z.boolean().optional(),
    approval: z.enum(['approve', 'deny']).optional(),
    deploymentMode: z.enum(['simulation', 'human_approval', 'full']).default('full'),
    expectedToolErrorCode: z.string().optional(),
    expect: z
      .object({
        state: z.string().optional(),
        intent: z.string().optional(),
        tools: z.array(z.string()).default([]),
        forbiddenTools: z.array(z.string()).default([]),
        policyDecision: z.enum(['allow', 'deny', 'require_approval']).nullable().optional(),
        policyRuleId: z.string().optional(),
        externalState: z
          .object({
            replacementsForOrder: z.number().int().min(0).optional(),
            orderStatus: z.string().optional(),
          })
          .strict()
          .optional(),
        evaluation: z
          .object({
            verifiedResolution: z.boolean(),
            checks: z.record(z.string(), verdict).default({}),
          })
          .strict()
          .optional(),
        responseMustContain: z.array(z.string()).default([]),
        responseMustNotContain: z.array(z.string()).default([]),
      })
      .strict(),
  })
  .strict();

export type Scenario = z.infer<typeof scenarioSchema>;
