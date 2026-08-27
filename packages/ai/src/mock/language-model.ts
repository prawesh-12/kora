import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';

export interface MockTurn {
  text?: string;
  toolCalls?: Array<{ toolName: string; input: unknown }>;
}

/**
 * Decides what the mock model does for one step, given the prompt the SDK built.
 * Returning `undefined` means "no opinion", and the next planner in the chain runs.
 */
export type MockPlanner = (ctx: MockPlannerContext) => MockTurn | undefined;

export interface MockPlannerContext {
  /** Every message flattened to plain text, oldest first. */
  transcript: string;
  /** Just the customer's text, joined. */
  customerText: string;
  /** Tool names the SDK offered on this step. */
  availableTools: string[];
  /** Tool results seen so far this run, in order. */
  toolResults: Array<{ toolName: string; output: unknown }>;
  /** Names of tools already called this run, in order. */
  calledTools: string[];
  options: LanguageModelV3CallOptions;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function usageFor(inputText: string, outputText: string): LanguageModelV3Usage {
  const inputTotal = estimateTokens(inputText);
  const outputTotal = estimateTokens(outputText);
  return {
    inputTokens: { total: inputTotal, noCache: inputTotal, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTotal, text: outputTotal, reasoning: 0 },
    totalTokens: inputTotal + outputTotal,
  } as LanguageModelV3Usage;
}

function textOf(part: unknown): string {
  if (typeof part === 'string') return part;
  if (part && typeof part === 'object') {
    const p = part as { type?: string; text?: string };
    if (p.type === 'text' && typeof p.text === 'string') return p.text;
  }
  return '';
}

/**
 * `toModelOutput` wraps a tool result as `{ type: 'text', value: '<json>' }` before
 * it reaches the model, so unwrap it back to the object the planners reason about.
 */
function unwrapToolOutput(output: unknown): unknown {
  if (!output || typeof output !== 'object') return output;
  const o = output as { type?: string; value?: unknown };
  if ((o.type === 'text' || o.type === 'json') && o.value !== undefined) {
    if (typeof o.value !== 'string') return o.value;
    try {
      return JSON.parse(o.value);
    } catch {
      return o.value;
    }
  }
  return output;
}

export function buildPlannerContext(options: LanguageModelV3CallOptions): MockPlannerContext {
  const lines: string[] = [];
  const customer: string[] = [];
  const toolResults: MockPlannerContext['toolResults'] = [];
  const calledTools: string[] = [];

  for (const message of options.prompt) {
    const content = (message as { content: unknown }).content;
    const role = (message as { role: string }).role;
    const parts = Array.isArray(content) ? content : [content];

    for (const part of parts) {
      const p = part as { type?: string; toolName?: string; output?: unknown; input?: unknown };
      if (p.type === 'tool-call' && p.toolName) calledTools.push(p.toolName);
      if (p.type === 'tool-result' && p.toolName) {
        const output = unwrapToolOutput(p.output);
        toolResults.push({ toolName: p.toolName, output });
        lines.push(`[tool-result ${p.toolName}] ${JSON.stringify(output)}`);
        continue;
      }
      const text = textOf(part);
      if (!text) continue;
      lines.push(`[${role}] ${text}`);
      if (role === 'user') customer.push(text);
    }
  }

  const available: string[] = [];
  for (const t of options.tools ?? []) {
    const name = (t as { name?: string }).name;
    if (name) available.push(name);
  }

  return {
    transcript: lines.join('\n'),
    customerText: customer.join('\n'),
    availableTools: available,
    toolResults,
    calledTools,
    options,
  };
}

export function createMockLanguageModel(args: {
  modelId: string;
  planners: MockPlanner[];
  /** Milliseconds to wait before responding, so timeout paths stay testable. */
  latencyMs?: number;
}): LanguageModelV3 {
  const plan = (ctx: MockPlannerContext): MockTurn => {
    for (const planner of args.planners) {
      const turn = planner(ctx);
      if (turn) return turn;
    }
    return { text: 'I am not able to help with that. Let me get a person to take a look.' };
  };

  const contentFor = (turn: MockTurn): LanguageModelV3Content[] => {
    const content: LanguageModelV3Content[] = [];
    if (turn.text) content.push({ type: 'text', text: turn.text });
    for (const [i, call] of (turn.toolCalls ?? []).entries()) {
      content.push({
        type: 'tool-call',
        toolCallId: `mock_call_${Date.now().toString(36)}_${i}`,
        toolName: call.toolName,
        input: JSON.stringify(call.input),
      });
    }
    return content;
  };

  const settle = async (options: LanguageModelV3CallOptions) => {
    if (args.latencyMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, args.latencyMs);
        options.abortSignal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(options.abortSignal?.reason ?? new Error('aborted'));
        });
      });
    }
    const ctx = buildPlannerContext(options);
    const turn = plan(ctx);
    const content = contentFor(turn);
    const hasToolCall = content.some((c) => c.type === 'tool-call');
    return {
      ctx,
      turn,
      content,
      finishReason: {
        unified: hasToolCall ? ('tool-calls' as const) : ('stop' as const),
        raw: hasToolCall ? 'tool_calls' : 'stop',
      },
      usage: usageFor(ctx.transcript, turn.text ?? JSON.stringify(turn.toolCalls ?? [])),
    };
  };

  return {
    specificationVersion: 'v3',
    provider: 'kora-mock',
    modelId: args.modelId,
    supportedUrls: {},

    async doGenerate(options) {
      const { content, finishReason, usage } = await settle(options);
      return { content, finishReason, usage, warnings: [] };
    },

    async doStream(options) {
      const { content, finishReason, usage } = await settle(options);
      const parts: LanguageModelV3StreamPart[] = [{ type: 'stream-start', warnings: [] }];

      for (const [i, item] of content.entries()) {
        if (item.type === 'text') {
          const id = `t${i}`;
          parts.push({ type: 'text-start', id });
          for (const chunk of item.text.match(/.{1,24}/gs) ?? []) {
            parts.push({ type: 'text-delta', id, delta: chunk });
          }
          parts.push({ type: 'text-end', id });
        } else if (item.type === 'tool-call') {
          parts.push({
            type: 'tool-input-start',
            id: item.toolCallId,
            toolName: item.toolName,
          });
          parts.push({ type: 'tool-input-delta', id: item.toolCallId, delta: item.input });
          parts.push({ type: 'tool-input-end', id: item.toolCallId });
          parts.push(item);
        }
      }

      parts.push({ type: 'finish', finishReason, usage });

      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            for (const p of parts) controller.enqueue(p);
            controller.close();
          },
        }),
      };
    },
  };
}
