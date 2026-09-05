import {
  type CompiledPolicy,
  type DeploymentMode,
  type KoraError,
  RETRY_POLICY,
  type RetryClass,
  type ToolErrorCode,
  ToolError,
  canonicalJson,
  backoffMs,
  budgetedTimeoutMs,
  isRetryable,
  newId,
  now,
  serverEnv,
} from '@kora/core';
import { type RunHandle, db, withTenant } from '@kora/db';
import { capExceeded, loadCaps, spentToday } from './caps.js';
import { STRIPE_WRITE_TOOLS, gateTenantStripeWrite } from './billing/write-gate.js';
import { breaker, toolBreakerKey } from './breaker.js';
import { buildFacts } from './facts.js';
import { decideAndRecordPolicy } from './policy-gate.js';
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
  /**
   * Replay only, keyed by `replayKey`. Its presence is what puts the pipeline in
   * replay: every call is served from here rather than from the business system.
   */
  recordedOutputs?: Record<string, unknown>;
}

function retryClassOf(tool: ToolDefinition): RetryClass {
  if (!tool.idempotent) return 'non_idempotent_write';
  return tool.sideEffect === 'read' ? 'read_tool' : 'idempotent_write';
}

/**
 * Canonical JSON, not `JSON.stringify`: the recorded side comes back out of a
 * `jsonb` column and Postgres does not preserve jsonb key order, so two spellings
 * of the same input would miss each other and the replay would quietly compare
 * against a synthetic response instead.
 */
export function replayKey(toolName: string, input: unknown): string {
  return `${toolName}:${canonicalJson(input)}`;
}

/** A failure that says nothing about the dependency's health must not trip its breaker. */
const BREAKER_FAILURE_CODES: ToolErrorCode[] = ['UPSTREAM_5XX', 'UPSTREAM_TIMEOUT'];

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
    'REPLAY_GAP',
    'CONFIG_ERROR',
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

  const isWrite = tool.sideEffect !== 'read';

  // 4. Policy check. Always written, including on allow. It runs before the
  // deployment-mode gate because simulation and shadow both have to show what the
  // policy engine *would* have decided.
  const evaluatedAt = now();
  const facts = buildFacts(tool.name, gathered, evaluatedAt, input);
  const { result: decision, checkId } = await decideAndRecordPolicy({
    tenantId: args.ctx.tenantId,
    runId: run.runId,
    policy,
    action: tool.name,
    facts,
    evaluatedAt,
    advisory: false,
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
      policyCheckId: checkId,
      reason: decision.reason,
      code: 'POLICY_DENIED',
    };
  }

  // 5. Limited-mode caps. Exceeding one sends the action to a person; it never fails.
  let overCap: string | null = null;
  if (isWrite && deploymentMode === 'limited') {
    const caps = await loadCaps(args.ctx.tenantId);
    const spent = await spentToday(args.ctx.tenantId);
    overCap = capExceeded(caps, spent, facts.amountMinor ?? null);
  }

  // 6. Approval gate.
  const needsApproval =
    decision.decision === 'require_approval' ||
    overCap !== null ||
    (deploymentMode === 'human_approval' && tool.sideEffect === 'write_high');

  if (needsApproval) {
    // A decision is made against the conversation, not the run: approving resumes
    // the work in a new run, and that run must not ask again.
    const forConversation = await repos.approvals.listForConversation(args.ctx.conversationId);
    const granted = forConversation.find(
      (a) => a.toolName === tool.name && a.status === 'approved',
    );
    const denied = forConversation.find((a) => a.toolName === tool.name && a.status === 'denied');

    if (denied) {
      await repos.toolExecutions.create({
        runId: run.runId,
        toolName: tool.name,
        toolVersion: tool.version,
        input,
        status: 'denied',
        errorCode: 'PERMISSION_DENIED',
        errorMessage: denied.decisionNote ?? 'a person declined this action',
        startedAt,
        finishedAt: now(),
        durationMs: 0,
      });
      return {
        status: 'denied',
        policyCheckId: checkId,
        reason: denied.decisionNote ?? 'a person declined this action',
        code: 'PERMISSION_DENIED',
      };
    }

    if (!granted) {
      const pending = forConversation.find(
        (a) => a.toolName === tool.name && a.status === 'pending',
      );
      const approval =
        pending ??
        (await repos.approvals.create({
          runId: run.runId,
          conversationId: args.ctx.conversationId,
          toolName: tool.name,
          proposedInput: input,
          reason: overCap ?? decision.reason,
          policyCheckId: checkId,
          status: 'pending',
          requestedAt: now(),
          expiresAt: new Date(now().getTime() + serverEnv().KORA_APPROVAL_TTL_MINUTES * 60_000),
        }));
      const reason = overCap ?? decision.reason;
      await run.record('approval', { tool: tool.name, approvalId: approval.id, reason });
      return { status: 'awaiting_approval', approvalId: approval.id, reason };
    }
  }

  // 7. Deployment mode gate. The only path a write can take in simulation or shadow.
  // It sits *after* the approval branch on purpose: a write that policy says needs a
  // person must still stop for one here rather than become a silent simulated success.
  const recorded = args.recordedOutputs?.[replayKey(tool.name, input)];

  if (
    args.recordedOutputs !== undefined &&
    recorded === undefined &&
    !isWrite &&
    tool.rerunOnReplay !== true
  ) {
    // A read the original run never made. Serving it from the live system would
    // compare the new version against today rather than against that day.
    return fail(
      'REPLAY_GAP',
      `${tool.name} was not called in the original run, so the state it would have read is unknown`,
      false,
      input,
    );
  }

  const servedFromRecord = recorded !== undefined && tool.rerunOnReplay !== true;

  if (
    servedFromRecord ||
    (isWrite && (deploymentMode === 'simulation' || deploymentMode === 'shadow'))
  ) {
    const output = recorded ?? { simulated: true, tool: tool.name, input };
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

  // A missing tenant Stripe key is a configuration fault, not a customer one, so it
  // is gated here: before the claim and the breaker, so it burns neither.
  if (STRIPE_WRITE_TOOLS.includes(tool.name)) {
    const keyGate = await gateTenantStripeWrite({
      tenantId: args.ctx.tenantId,
      conversationId: args.ctx.conversationId,
      runId: run.runId,
      toolName: tool.name,
    });
    if (!keyGate.ok) {
      return fail(keyGate.outcome.code, keyGate.outcome.error, keyGate.outcome.retryable, input);
    }
  }

  // 8. Circuit breaker. Checked before the claim so a downed dependency costs one
  // Redis read instead of an idempotency row and a doomed HTTP call. Redis itself
  // being down fails writes closed: a write never runs while we cannot tell a
  // healthy dependency from a downed one.
  const breakerKey = toolBreakerKey(args.ctx.tenantId, tool.name);
  const verdict = await breaker().gate(breakerKey, isWrite ? 'write' : 'read');
  if (!verdict.pass) {
    return fail(
      'UPSTREAM_5XX',
      verdict.reason === 'open'
        ? `${tool.name} is failing upstream, so calls to it are paused`
        : `${tool.name} is a write and the circuit breaker store is unreachable, so it cannot run safely`,
      false,
      input,
    );
  }

  // 9. Idempotency claim.
  const key = deriveKey({
    tenantId: args.ctx.tenantId,
    conversationId: args.ctx.conversationId,
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

  // Unreachable by construction: the deployment-mode gate is the only path a write
  // takes in shadow. Asserted anyway, because an unreachable branch that becomes
  // reachable is otherwise silent.
  if (deploymentMode === 'shadow' && isWrite) {
    throw new Error(`${tool.name} reached execution in shadow mode; nothing may be written`);
  }

  // 10. Execute, with a bounded retry inside the run deadline.
  const retryClass = retryClassOf(tool);
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
      budgetedTimeoutMs(tool.timeoutMs, args.ctx.deadlineAt),
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
      if (ctx.fault === '500' || ctx.fault === 'timeout') {
        clearTimeout(timer);
        throw new ToolError(`scenario fault ${ctx.fault} on ${tool.name}`, {
          code: ctx.fault === '500' ? 'UPSTREAM_5XX' : 'UPSTREAM_TIMEOUT',
          retryable: true,
        });
      }
      const raw = await tool.execute(input, ctx);
      clearTimeout(timer);

      // 11. Validate output.
      const out = tool.outputSchema.safeParse(raw);
      if (!out.success) {
        lastCode = 'MALFORMED_OUTPUT';
        lastMessage = `the business system returned a response that does not match ${tool.name}'s schema`;
        await settleFailure(key, lastCode);
        return fail(lastCode, lastMessage, false, input, key, attempt);
      }
      const output = out.data;

      // 12. Verify. Absence of verification is not verification.
      const verification = tool.verify ? await runVerification(tool, input, output, ctx) : null;
      const verified = verification ? verification.verified : null;

      // 13. Settle idempotency and write the execution row together.
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

      await breaker().recordSuccess(breakerKey);
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

      // Never retry a write that is not marked idempotent: `retryClassOf` maps it to
      // the class that never retries.
      if (!retryable || !isRetryable(retryClass, e) || attempt > tool.maxRetries) {
        await settleFailure(key, lastCode);
        // One breaker failure per tool call, not per attempt: the retry table already
        // bounds the attempts, and counting each of them would open the breaker on the
        // second failed call and make the table meaningless.
        if (BREAKER_FAILURE_CODES.includes(lastCode)) await breaker().recordFailure(breakerKey);
        return { status: 'failed', code: lastCode, error: lastMessage, retryable };
      }

      await new Promise((r) => setTimeout(r, backoffMs(RETRY_POLICY[retryClass], attempt)));
      attempt++;
    }
  }
}

export function newIdempotencyScope(): string {
  return newId('idm');
}
