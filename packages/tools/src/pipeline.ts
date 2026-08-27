import {
  type CompiledPolicy,
  type DeploymentMode,
  type KoraError,
  type ToolErrorCode,
  evaluatePolicy,
  newId,
  now,
  serverEnv,
} from '@kora/core';
import { type RunHandle, db, withTenant } from '@kora/db';
import { buildFacts } from './facts.js';
import { claim, deriveKey, requestHash, settleFailure, settleSuccess } from './idempotency.js';
import type { GatheredContext, ToolContext, ToolDefinition, ToolOutcome } from './types.js';
import { runVerification } from './verify.js';

export interface ExecuteToolArgs {
  tool: ToolDefinition;
  rawInput: unknown;
  ctx: Omit<ToolContext, 'idempotencyKey' | 'signal' | 'policy' | 'gathered'>;
  policy: CompiledPolicy;
  deploymentMode: DeploymentMode;
  allowedTools: Array<{ name: string; version: number }>;
  grantedPermissions: string[];
  gathered: GatheredContext;
  run: RunHandle;
}

function backoffMs(attempt: number): number {
  return Math.floor(Math.min(2 ** attempt * 250, 4000) * Math.random());
}

function codeOf(error: unknown, fallback: ToolErrorCode): ToolErrorCode {
  const code = (error as KoraError)?.code;
  const known: ToolErrorCode[] = [
    'INVALID_INPUT',
    'PERMISSION_DENIED',
    'POLICY_DENIED',
    'UPSTREAM_TIMEOUT',
    'UPSTREAM_5XX',
    'UPSTREAM_4XX',
    'MALFORMED_OUTPUT',
    'VERIFY_FAILED',
    'DEADLINE_EXCEEDED',
    'TOOL_SELECTION_FAILURE',
  ];
  return known.includes(code as ToolErrorCode) ? (code as ToolErrorCode) : fallback;
}

/**
 * The single chokepoint. Stages run in this order and the order is load-bearing:
 * a policy check after execution is not a policy check.
 */
export async function executeTool(args: ExecuteToolArgs): Promise<ToolOutcome<unknown>> {
  const { tool, rawInput, policy, deploymentMode, gathered, run } = args;
  const repos = withTenant(args.ctx.tenantId);
  const startedAt = now();

  const fail = async (
    code: ToolErrorCode,
    message: string,
    retryable: boolean,
    input: unknown = rawInput,
    idempotencyKey: string | null = null,
    attempt = 1,
  ): Promise<ToolOutcome<unknown>> => {
    await repos.toolExecutions.create({
      runId: run.runId,
      toolName: tool.name,
      toolVersion: tool.version,
      input,
      status: 'failed',
      idempotencyKey,
      attempt,
      errorCode: code,
      errorMessage: message,
      startedAt,
      finishedAt: now(),
      durationMs: now().getTime() - startedAt.getTime(),
    });
    return { status: 'failed', code, error: message, retryable };
  };

  // 1. Resolve version. The agent config pins the pair.
  const pinned = args.allowedTools.find((t) => t.name === tool.name);
  if (pinned && pinned.version !== tool.version) {
    return fail(
      'TOOL_SELECTION_FAILURE',
      `agent config pins ${tool.name}@${pinned.version} but the registry holds v${tool.version}`,
      false,
    );
  }

  // 2. Validate input.
  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    await run.record(
      'tool',
      { tool: tool.name, status: 'invalid_input', issues: parsed.error.issues },
      'failed',
    );
    return { status: 'invalid_input', issues: parsed.error.issues };
  }
  const input = parsed.data;

  // 3. Permission check. Fail closed: a tool not explicitly listed is denied.
  if (!pinned) {
    return fail(
      'PERMISSION_DENIED',
      `${tool.name} is not in the agent's allowed tools`,
      false,
      input,
    );
  }
  if (!args.grantedPermissions.includes(tool.requiredPermission)) {
    return fail(
      'PERMISSION_DENIED',
      `${tool.name} needs ${tool.requiredPermission}, which is not granted`,
      false,
      input,
    );
  }

  // 4. Deployment mode gate.
  const isWrite = tool.sideEffect !== 'read';
  if (deploymentMode === 'simulation' && isWrite) {
    const output = { simulated: true, tool: tool.name, input };
    await repos.toolExecutions.create({
      runId: run.runId,
      toolName: tool.name,
      toolVersion: tool.version,
      input,
      output,
      status: 'simulated',
      startedAt,
      finishedAt: now(),
      durationMs: 0,
    });
    return { status: 'simulated', output };
  }

  // 5. Policy check. Always written, including on allow.
  const facts = buildFacts(tool.name, gathered, now());
  const decision = evaluatePolicy(policy, facts, now());
  const check = await repos.policyChecks.create({
    runId: run.runId,
    policyKey: decision.policyKey,
    policyVersion: decision.policyVersion,
    ruleId: decision.ruleId,
    action: tool.name,
    decision: decision.decision,
    reason: decision.reason,
    facts: decision.factsUsed,
    missingFacts: decision.missingFacts,
    createdAt: now(),
  });

  if (decision.decision === 'deny') {
    await repos.toolExecutions.create({
      runId: run.runId,
      toolName: tool.name,
      toolVersion: tool.version,
      input,
      status: 'denied',
      errorCode: 'POLICY_DENIED',
      errorMessage: decision.reason,
      startedAt,
      finishedAt: now(),
      durationMs: 0,
    });
    return {
      status: 'denied',
      policyCheckId: check.id,
      reason: decision.reason,
      code: 'POLICY_DENIED',
    };
  }

  const needsApproval =
    decision.decision === 'require_approval' ||
    (deploymentMode === 'human_approval' && tool.sideEffect === 'write_high');

  if (needsApproval) {
    const existing = (await repos.approvals.listForRun(run.runId)).find(
      (a) => a.toolName === tool.name && a.status === 'pending',
    );
    const approval =
      existing ??
      (await repos.approvals.create({
        runId: run.runId,
        conversationId: args.ctx.conversationId,
        toolName: tool.name,
        proposedInput: input,
        reason: decision.reason,
        policyCheckId: check.id,
        status: 'pending',
        requestedAt: now(),
        expiresAt: new Date(now().getTime() + serverEnv().KORA_APPROVAL_TTL_MINUTES * 60_000),
      }));
    await run.record('approval', {
      tool: tool.name,
      approvalId: approval.id,
      reason: decision.reason,
    });
    return { status: 'awaiting_approval', approvalId: approval.id, reason: decision.reason };
  }

  // 6. Idempotency claim.
  const key = deriveKey({
    tenantId: args.ctx.tenantId,
    conversationId: args.ctx.conversationId,
    runId: run.runId,
    toolName: tool.name,
    toolVersion: tool.version,
    input,
  });
  const claimed = await claim({
    key,
    tenantId: args.ctx.tenantId,
    scope: tool.name,
    requestHash: requestHash(input),
    maxRetries: tool.maxRetries,
  });

  if (claimed.kind === 'replayed') {
    await repos.toolExecutions.create({
      runId: run.runId,
      toolName: tool.name,
      toolVersion: tool.version,
      input,
      output: claimed.response,
      status: 'replayed',
      idempotencyKey: key,
      startedAt,
      finishedAt: now(),
      durationMs: 0,
    });
    return { status: 'replayed', output: claimed.response };
  }

  if (claimed.kind === 'failed') {
    return fail(
      claimed.errorCode as ToolErrorCode,
      'a previous attempt with this key failed',
      false,
      input,
      key,
    );
  }

  if (claimed.kind === 'busy') {
    return fail(
      'UPSTREAM_TIMEOUT',
      'another attempt with the same key is still in progress',
      true,
      input,
      key,
    );
  }

  // 7. Execute, with a bounded retry inside the run deadline.
  let attempt = claimed.attempt;
  let lastCode: ToolErrorCode = 'UPSTREAM_5XX';
  let lastMessage = 'tool failed';

  for (;;) {
    const remainingMs = args.ctx.deadlineAt.getTime() - now().getTime();
    if (remainingMs <= 0) {
      await settleFailure(key, 'DEADLINE_EXCEEDED');
      return fail(
        'DEADLINE_EXCEEDED',
        'the run deadline passed before the tool could run',
        false,
        input,
        key,
        attempt,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('tool timed out')),
      Math.min(tool.timeoutMs, remainingMs),
    );
    const ctx: ToolContext = {
      ...args.ctx,
      idempotencyKey: key,
      signal: controller.signal,
      policy,
      gathered,
    };
    const attemptStartedAt = now();

    try {
      const raw = await tool.execute(input, ctx);
      clearTimeout(timer);

      // 8. Validate output.
      const out = tool.outputSchema.safeParse(raw);
      if (!out.success) {
        lastCode = 'MALFORMED_OUTPUT';
        lastMessage = `the business system returned a response that does not match ${tool.name}'s schema`;
        await settleFailure(key, lastCode);
        return fail(lastCode, lastMessage, false, input, key, attempt);
      }
      const output = out.data;

      // 9. Verify. Absence of verification is not verification.
      const verification = tool.verify ? await runVerification(tool, input, output, ctx) : null;
      const verified = verification ? verification.verified : null;

      // 10. Settle idempotency and write the execution row together.
      await db().transaction(async (tx) => {
        await settleSuccess(key, output, tx);
        await withTenant(args.ctx.tenantId, tx).toolExecutions.create({
          runId: run.runId,
          toolName: tool.name,
          toolVersion: tool.version,
          input,
          output,
          status: 'ok',
          verified,
          verifyObserved: verification ? verification.observed : null,
          idempotencyKey: key,
          attempt,
          startedAt: attemptStartedAt,
          finishedAt: now(),
          durationMs: now().getTime() - attemptStartedAt.getTime(),
          ...(verification && !verification.verified
            ? { errorCode: 'VERIFY_FAILED' as const, errorMessage: verification.reason }
            : {}),
        });
      });

      return {
        status: 'ok',
        output,
        verified,
        durationMs: now().getTime() - attemptStartedAt.getTime(),
      };
    } catch (e) {
      clearTimeout(timer);
      const aborted = (e as Error).name === 'AbortError' || controller.signal.aborted;
      lastCode = aborted ? 'UPSTREAM_TIMEOUT' : codeOf(e, 'UPSTREAM_5XX');
      lastMessage = (e as Error).message;
      const retryable = aborted || (e as KoraError)?.retryable === true;

      await repos.toolExecutions.create({
        runId: run.runId,
        toolName: tool.name,
        toolVersion: tool.version,
        input,
        status: 'failed',
        idempotencyKey: key,
        attempt,
        errorCode: lastCode,
        errorMessage: lastMessage,
        startedAt: attemptStartedAt,
        finishedAt: now(),
        durationMs: now().getTime() - attemptStartedAt.getTime(),
      });

      // Never retry a write that is not marked idempotent.
      if (!retryable || !tool.idempotent || attempt > tool.maxRetries) {
        await settleFailure(key, lastCode);
        return { status: 'failed', code: lastCode, error: lastMessage, retryable };
      }

      await new Promise((r) => setTimeout(r, backoffMs(attempt)));
      attempt++;
    }
  }
}

export function newIdempotencyScope(): string {
  return newId('idm');
}
