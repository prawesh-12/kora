import {
  type AgentState,
  type DeploymentMode,
  type EscalationReason,
  HANDOVER_INTENTS,
  type Intent,
  READ_ONLY_INTENTS,
  type RunOutcome,
  childLogger,
  now,
  serverEnv,
} from '@kora/core';
import { type RunHandle, emit, startRun, withTenant } from '@kora/db';
import {
  type GatheredContext,
  type ToolContext,
  type ToolDefinition,
  type ToolOutcome,
  executeTool,
  registry,
} from '@kora/tools';
import { type ToolSet, ToolLoopAgent, hasToolCall, stepCountIs, tool } from 'ai';
import { type ResolvedAgentConfig, resolveAgentConfig } from './config.js';
import { escalate } from './escalation.js';
import { UNGROUNDED_FALLBACK, checkGrounding } from './grounding.js';
import { detectIntent } from './intent.js';
import { type RetrievedChunk, retrieve } from './knowledge/search.js';
import { getModel } from './models.js';
import { assemblePrompt } from './prompts/assemble.js';
import { assertTransition } from './state.js';

/** Read tools are exposed first; a write tool only appears once an order exists. */
const READ_TOOLS = ['get_order', 'get_customer', 'search_knowledge', 'check_policy'];

/**
 * Which write tool each intent is allowed to reach. A tool absent from this map
 * is never exposed for that intent, whatever the model proposes, so
 * `gateToolsByState` removes a whole class of wrong-tool errors without any
 * prompt engineering. `ORDER_STATUS` has none by design.
 */
const WRITE_TOOLS_BY_INTENT: Record<Intent, string[]> = {
  ORDER_STATUS: [],
  DAMAGED_ORDER: ['create_replacement'],
  CANCEL_ORDER: ['cancel_order'],
  REFUND_REQUEST: ['create_refund'],
  HUMAN_REQUEST: [],
  OUT_OF_SCOPE: [],
};

export interface TurnResult {
  runId: string;
  traceId: string;
  conversationId: string;
  finalState: AgentState;
  outcome: RunOutcome;
  intent: Intent | null;
  text: string;
  toolsCalled: string[];
  approvalId: string | null;
  escalationReason: EscalationReason | null;
}

interface TurnState {
  gathered: GatheredContext;
  chunks: RetrievedChunk[];
  toolOutputs: unknown[];
  toolsCalled: string[];
  approvalId: string | null;
  unverifiedWrite: boolean;
  terminalFailure: boolean;
}

/**
 * Every `ToolOutcome` becomes something the model can reason about. Throwing here
 * would abort the loop and lose the trace, so nothing throws.
 */
function toModelResult(outcome: ToolOutcome<unknown>): unknown {
  switch (outcome.status) {
    case 'ok':
      return outcome.verified === false
        ? {
            ok: false,
            reason: 'the write was accepted but could not be confirmed in the business system',
            canRetry: false,
            suggestion: 'escalate_to_human',
          }
        : outcome.output;
    case 'replayed':
      return outcome.output;
    case 'simulated':
      return outcome.output;
    case 'denied':
      return {
        ok: false,
        reason: outcome.reason,
        canRetry: false,
        suggestion: 'explain the policy to the customer',
      };
    case 'awaiting_approval':
      return {
        ok: false,
        reason: outcome.reason,
        canRetry: false,
        suggestion: 'tell the customer a colleague is reviewing this',
        awaitingApproval: true,
      };
    case 'invalid_input':
      return { ok: false, issues: outcome.issues, canRetry: true };
    case 'failed':
      return {
        ok: false,
        reason: outcome.error,
        code: outcome.code,
        canRetry: outcome.retryable,
        ...(outcome.retryable ? {} : { suggestion: 'escalate_to_human' }),
      };
  }
}

const MAX_TOOL_OUTPUT_CHARS = 8000;

/**
 * Keeps a large tool payload out of the context window without ever handing the
 * model a half-finished JSON document. Slicing the string mid-object produces
 * something that looks like data and parses like nothing.
 */
function summarizeForModel(output: unknown): string {
  const json = JSON.stringify(output ?? null);
  if (json.length <= MAX_TOOL_OUTPUT_CHARS) return json;
  return JSON.stringify({
    truncated: true,
    note: 'this result was too large to show in full; the complete value is in the trace',
    preview: json.slice(0, MAX_TOOL_OUTPUT_CHARS),
  });
}

function buildTools(args: {
  config: ResolvedAgentConfig;
  ctx: Omit<ToolContext, 'idempotencyKey' | 'signal' | 'policy' | 'gathered'>;
  deploymentMode: DeploymentMode;
  run: RunHandle;
  state: TurnState;
  faults: Record<string, string>;
  recordedOutputs?: Record<string, unknown>;
}) {
  const tools: ToolSet = {};

  for (const pinned of args.config.allowedTools) {
    const def: ToolDefinition = registry.get(pinned.name, pinned.version);

    tools[def.name] = tool({
      description: def.description,
      inputSchema: def.inputSchema,
      ...(def.inputExamples ? { inputExamples: def.inputExamples } : {}),
      execute: async (input: unknown) => {
        const outcome = await executeTool({
          tool: def,
          rawInput: input,
          ctx: {
            ...args.ctx,
            ...(args.faults[def.name] ? { fault: args.faults[def.name] } : {}),
            searchKnowledge: makeSearcher(args.ctx.tenantId, args.state, args.run),
          },
          policy: args.config.compiledPolicy,
          deploymentMode: args.deploymentMode,
          allowedTools: args.config.allowedTools,
          grantedPermissions: args.config.permissions,
          gathered: args.state.gathered,
          run: args.run,
          ...(args.recordedOutputs ? { recordedOutputs: args.recordedOutputs } : {}),
        });

        args.state.toolsCalled.push(def.name);
        recordOutcome(def, outcome, args.state);
        return toModelResult(outcome);
      },
      toModelOutput: ({ output }: { output: unknown }) => ({
        type: 'text' as const,
        value: summarizeForModel(output),
      }),
    }) as ToolSet[string];
  }

  return tools;
}

function makeSearcher(tenantId: string, state: TurnState, run: RunHandle) {
  return async (input: { query: string; topic?: string | undefined; topK: number }) => {
    const result = await retrieve({
      tenantId,
      query: input.query,
      filters: { topic: input.topic, asOf: now() },
      topK: input.topK,
      run,
    });
    state.chunks = result.chunks;
    return { chunks: result.chunks };
  };
}

function recordOutcome(def: ToolDefinition, outcome: ToolOutcome<unknown>, state: TurnState): void {
  if (outcome.status === 'awaiting_approval') {
    state.approvalId = outcome.approvalId;
    return;
  }

  if (outcome.status === 'failed' || outcome.status === 'denied') {
    if (outcome.status === 'failed' && !outcome.retryable) state.terminalFailure = true;
    return;
  }

  if (outcome.status !== 'ok' && outcome.status !== 'replayed' && outcome.status !== 'simulated') {
    return;
  }

  const output = outcome.output as Record<string, unknown>;
  state.toolOutputs.push(output);

  if (outcome.status === 'ok' && def.sideEffect !== 'read' && outcome.verified === false) {
    state.unverifiedWrite = true;
  }

  // Facts for the policy engine come from here, and only from here.
  if (def.name === 'get_order') {
    state.gathered.order = output as unknown as NonNullable<GatheredContext['order']>;
    const refunded = (output as { refundedAmountMinor?: number }).refundedAmountMinor;
    if (typeof refunded === 'number') state.gathered.refundedAmountMinor = refunded;
  }
  if (def.name === 'get_customer') {
    state.gathered.customer = output as unknown as NonNullable<GatheredContext['customer']>;
  }
}

export async function runAgentTurn(args: {
  tenantId: string;
  conversationId: string;
  message: string;
  deploymentMode?: DeploymentMode;
  /** Scenario use only: arms an Acme fault for the named tool. */
  faults?: Record<string, string>;
  /** Replay only: pins the agent version whose behaviour is being measured. */
  agentVersionId?: string;
  /** Replay only: the original run's tool outputs, keyed `toolName:json(input)`. */
  recordedOutputs?: Record<string, unknown>;
}): Promise<TurnResult> {
  const env = serverEnv();
  // Pinned once, here. A version published mid-run does not change this run's
  // behaviour, which is what makes an in-flight conversation survive a promotion.
  const config = await resolveAgentConfig(args.tenantId, args.agentVersionId);
  const repos = withTenant(args.tenantId);
  const deploymentMode = args.deploymentMode ?? env.KORA_DEPLOYMENT_MODE;

  const customerMessage = await repos.messages.create({
    conversationId: args.conversationId,
    role: 'customer',
    content: args.message,
    parts: [{ type: 'text', text: args.message }],
    createdAt: now(),
  });

  const run = await startRun({
    deploymentMode,
    tenantId: args.tenantId,
    conversationId: args.conversationId,
    agentConfigVersion: config.configVersion,
    agentVersionId: config.agentVersionId,
    triggerMessageId: customerMessage.id,
  });

  const logger = childLogger({
    traceId: run.traceId,
    tenantId: args.tenantId,
    runId: run.runId,
  });

  const state: TurnState = {
    gathered: { deploymentMode },
    chunks: [],
    toolOutputs: [],
    toolsCalled: [],
    approvalId: null,
    unverifiedWrite: false,
    terminalFailure: false,
  };

  // A holder rather than a `let`: TypeScript narrows a closure-mutated local to its
  // initial value, which makes every later state comparison look impossible.
  const fsm: { state: AgentState } = { state: 'NEW' };
  const move = async (next: AgentState) => {
    assertTransition(fsm.state, next);
    fsm.state = next;
    await run.setState(next);
  };

  const finish = async (
    text: string,
    outcome: RunOutcome,
    reason: EscalationReason | null,
    intent: Intent | null,
  ): Promise<TurnResult> => {
    await repos.messages.create({
      conversationId: args.conversationId,
      role: 'agent',
      content: text,
      parts: [{ type: 'text', text }],
      createdAt: now(),
    });
    await repos.runs.patch(run.runId, {
      intent,
      ...(reason ? { errorCode: reason } : {}),
    });
    await run.finish(outcome, fsm.state);

    // Emitted last, once the run row is complete. The worker reads the finished
    // run, so an event that arrives before `finish` would evaluate a partial trace.
    await emit('run.finished', {
      tenantId: args.tenantId,
      traceId: run.traceId,
      runId: run.runId,
      conversationId: args.conversationId,
      outcome,
      finalState: fsm.state,
      occurredAt: now(),
    });
    return {
      runId: run.runId,
      traceId: run.traceId,
      conversationId: args.conversationId,
      finalState: fsm.state,
      outcome,
      intent,
      text,
      toolsCalled: state.toolsCalled,
      approvalId: state.approvalId,
      escalationReason: reason,
    };
  };

  const handOver = async (
    reason: EscalationReason,
    text: string,
    intent: Intent | null,
    note?: string,
  ): Promise<TurnResult> => {
    await escalate({
      run,
      reason,
      ...(note ? { note } : {}),
      gathered: state.gathered,
      intent: intentSummary,
      chunks: state.chunks,
    });
    if (fsm.state !== 'NEEDS_HUMAN') await move('NEEDS_HUMAN');
    return finish(text, reason === 'CUSTOMER_REQUESTED' ? 'escalated' : 'failed', reason, intent);
  };

  let intentSummary: { value: Intent; confidence: number; evidence: string } | null = null;

  await move('IDENTIFYING_INTENT');

  const messages = await repos.messages.listForConversation(args.conversationId);
  const detected = await detectIntent({
    tenantId: args.tenantId,
    messages,
    threshold: config.confidenceThreshold,
    run,
  });

  if (!detected.ok) {
    logger.warn({ code: detected.error.code }, 'intent detection failed');
    return handOver(
      'UNSUPPORTED_SCENARIO',
      'I am having trouble understanding this one. I have passed it to a colleague who will come back to you shortly.',
      null,
    );
  }

  const intent = detected.value.intent;
  intentSummary = {
    value: intent,
    confidence: detected.value.confidence,
    evidence: detected.value.evidence,
  };
  await repos.runs.patch(run.runId, { intent, intentConfidence: detected.value.confidence });
  await emit('intent.detected', {
    tenantId: args.tenantId,
    traceId: run.traceId,
    runId: run.runId,
    conversationId: args.conversationId,
    intent,
    confidence: detected.value.confidence,
    occurredAt: now(),
  });
  await repos.conversations.patch(args.conversationId, { intent });
  state.gathered.intent = intent;

  if (detected.value.belowThreshold) {
    return handOver(
      'LOW_CONFIDENCE',
      'I want to make sure this is handled properly, so I have passed it to a colleague. Someone will be with you shortly.',
      intent,
    );
  }

  // HUMAN_REQUEST and OUT_OF_SCOPE hand over with zero context-gathering calls.
  // These hand over with zero context-gathering calls.
  if (HANDOVER_INTENTS.includes(intent)) {
    return intent === 'HUMAN_REQUEST'
      ? handOver(
          'CUSTOMER_REQUESTED',
          'Of course. I have passed you to a colleague and someone will be with you shortly.',
          intent,
        )
      : handOver(
          'UNSUPPORTED_SCENARIO',
          'That is not something I can help with directly. I have passed it to a colleague who will come back to you shortly.',
          intent,
        );
  }

  await move('GATHERING_CONTEXT');

  const ctx = {
    tenantId: args.tenantId,
    conversationId: args.conversationId,
    runId: run.runId,
    traceId: run.traceId,
    agentConfigVersion: config.configVersion,
    actorId: 'agent',
    deadlineAt: new Date(now().getTime() + config.runDeadlineMs),
    logger,
  };

  const tools = buildTools({
    config,
    ctx,
    deploymentMode,
    run,
    state,
    faults: args.faults ?? {},
    ...(args.recordedOutputs ? { recordedOutputs: args.recordedOutputs } : {}),
  });

  // Recorded so an operator can prove from the trace which tools were ever on the
  // table, rather than inferring it from what happened to be called.
  const exposedTools: string[][] = [];

  const agent = new ToolLoopAgent({
    model: getModel('agent'),
    instructions: assemblePrompt({
      policy: config.compiledPolicy,
      tools: config.allowedTools.map((t) => registry.get(t.name, t.version)),
      chunks: [],
      messages,
    }),
    tools,
    stopWhen: [stepCountIs(config.maxSteps), hasToolCall('escalate_to_human')],
    prepareStep: () => {
      const activeTools = gateToolsByState(config, intent, state);
      exposedTools.push(activeTools);
      return { activeTools: activeTools as never };
    },
  });

  await move('PLANNING');

  let text = '';
  try {
    const result = await agent.generate({ prompt: args.message });
    text = result.text.trim();
    await run.record('model', { intent, exposedTools });
  } catch (e) {
    await run.record('model', { intent, exposedTools }, 'failed');
    logger.error({ err: e }, 'the agent loop threw');
    return handOver(
      'TOOL_FAILED',
      'Something went wrong on our side. I have passed this to a colleague who will come back to you shortly.',
      intent,
    );
  }

  // An unverified write is the most dangerous state the system can be in.
  // Stop talking about it and get a person.
  if (state.unverifiedWrite) {
    if (fsm.state === 'PLANNING') await move('WAITING_FOR_TOOL');
    if (fsm.state === 'WAITING_FOR_TOOL') await move('VERIFYING');
    return handOver(
      'VERIFICATION_FAILED',
      'I have started this for you but I cannot confirm it went through, so I am not going to guess. A colleague is checking now and will confirm shortly.',
      intent,
    );
  }

  if (state.approvalId) {
    if (fsm.state === 'PLANNING') await move('AWAITING_APPROVAL');
    return finish(
      text ||
        'This one needs a quick check by a colleague before I can send it. I will come back to you as soon as it is approved.',
      'escalated',
      null,
      intent,
    );
  }

  if (state.toolsCalled.includes('escalate_to_human')) {
    const reason: EscalationReason = state.terminalFailure ? 'TOOL_FAILED' : 'UNSUPPORTED_SCENARIO';
    return handOver(
      reason,
      text || 'I have passed this to a colleague who will come back to you shortly.',
      intent,
    );
  }

  const grounding = checkGrounding(text, state.toolOutputs, args.message);
  if (!grounding.grounded) {
    logger.warn({ unsupported: grounding.unsupported, draft: text }, 'grounding check failed');
    await run.record(
      'response',
      { draft: text, unsupported: grounding.unsupported, replaced: true },
      'failed',
    );
    return handOver('VERIFICATION_FAILED', UNGROUNDED_FALLBACK, intent, 'ungrounded response');
  }

  if (fsm.state === 'PLANNING') await move('RESPONDING');
  await run.record('response', { text });
  await move('RESOLVED');
  return finish(text, 'resolved_automatically', null, intent);
}

/**
 * Narrows the tool set per step. Read tools are always available; a write tool
 * appears only once an order has actually been fetched, and only if this intent
 * is allowed to reach it.
 */
export function gateToolsByState(
  config: ResolvedAgentConfig,
  intent: Intent,
  state: Pick<TurnState, 'gathered'>,
): string[] {
  const registered = new Set(config.allowedTools.map((t) => t.name));
  const active = [...READ_TOOLS, 'escalate_to_human'].filter((n) => registered.has(n));

  if (READ_ONLY_INTENTS.includes(intent)) return active;
  if (!state.gathered.order) return active;

  for (const name of WRITE_TOOLS_BY_INTENT[intent]) {
    if (registered.has(name)) active.push(name);
  }
  return active;
}
