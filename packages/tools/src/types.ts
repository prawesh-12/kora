import type {
  CompiledPolicy,
  DeploymentMode,
  Logger,
  PolicyDecision,
  SideEffect,
  ToolErrorCode,
} from '@kora/core';
import type { z } from 'zod';

export interface ToolContext {
  tenantId: string;
  conversationId: string;
  runId: string;
  traceId: string;
  agentConfigVersion: string;
  actorId: string;
  idempotencyKey: string;
  deadlineAt: Date;
  /** Aborts when the tool timeout or the run deadline fires, whichever is sooner. */
  signal: AbortSignal;
  logger: Logger;
  /** The compiled policy, so `check_policy` can answer without any I/O. */
  policy: CompiledPolicy;
  /** Everything this run has already established from records, never from model text. */
  gathered: GatheredContext;
  /**
   * Retrieval lives in `@kora/ai`, which depends on this package, so it cannot be
   * imported here. The caller injects it instead.
   */
  searchKnowledge?: KnowledgeSearcher;
  /** Forwarded to Acme as X-Acme-Fault so scenarios can arm a fault. */
  fault?: string | undefined;
}

export type VerifyResult =
  | { verified: true; observed: unknown }
  | { verified: false; observed: unknown; reason: string };

export interface ToolDefinition<
  I extends z.ZodTypeAny = z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
> {
  name: string;
  version: number;
  description: string;
  inputSchema: I;
  outputSchema: O;
  sideEffect: SideEffect;
  requiredPermission: string;
  timeoutMs: number;
  maxRetries: number;
  idempotent: boolean;
  terminal?: boolean;
  inputExamples?: Array<{ input: z.infer<I> }>;
  execute(input: z.infer<I>, ctx: ToolContext): Promise<z.infer<O>>;
  verify?(input: z.infer<I>, output: z.infer<O>, ctx: ToolContext): Promise<VerifyResult>;
}

export type ToolOutcome<O> =
  | { status: 'ok'; output: O; verified: boolean | null; durationMs: number }
  | { status: 'denied'; policyCheckId: string; reason: string; code: ToolErrorCode }
  | { status: 'awaiting_approval'; approvalId: string; reason: string }
  | { status: 'invalid_input'; issues: z.core.$ZodIssue[] }
  | { status: 'failed'; code: ToolErrorCode; error: string; retryable: boolean }
  | { status: 'replayed'; output: O }
  | { status: 'simulated'; output: O };

export interface GatheredContext {
  order?: {
    id: string;
    customerId: string;
    status: string;
    items: Array<{ sku: string; category: string; quantity: number; unitAmountMinor: number }>;
    totalAmountMinor: number;
    currency: string;
    deliveredAt: string | null;
    replacementIds: string[];
  };
  customer?: { id: string; name: string; email: string };
  retrievedChunkIds?: string[];
  intent?: string;
  lastPolicyDecision?: PolicyDecision;
  deploymentMode?: DeploymentMode;
}

export interface KnowledgeChunk {
  chunkId: string;
  documentId: string;
  documentVersion: number;
  title: string;
  headingPath: string;
  content: string;
  distance: number;
}

export type KnowledgeSearcher = (args: {
  query: string;
  topic?: string | undefined;
  topK: number;
}) => Promise<{ chunks: KnowledgeChunk[] }>;
