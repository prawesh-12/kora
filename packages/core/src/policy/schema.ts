import { z } from 'zod';

const operand = z.union([z.string(), z.number(), z.boolean()]);

const matcher = z
  .object({
    eq: operand.optional(),
    neq: operand.optional(),
    in: z.array(operand).optional(),
    notIn: z.array(operand).optional(),
    gt: z.number().optional(),
    gte: z.number().optional(),
    lt: z.number().optional(),
    lte: z.number().optional(),
    exists: z.boolean().optional(),
  })
  .strict()
  .refine((m) => Object.keys(m).length > 0, { message: 'a matcher needs at least one operator' });

const rule = z
  .object({
    id: z.string().min(1),
    when: z.record(z.string(), matcher),
    decision: z.enum(['allow', 'deny', 'require_approval']),
    reason: z.string().min(1),
  })
  .strict();

export const policyFileSchema = z
  .object({
    key: z.string().min(1),
    version: z.string().min(1),
    description: z.string().default(''),
    currency: z.string().length(3),
    default: z.enum(['allow', 'deny', 'require_approval']),
    rules: z.array(rule).min(1),
  })
  .strict();

export type PolicyFile = z.infer<typeof policyFileSchema>;
