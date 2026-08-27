import { ConfigError, serverEnv } from '@kora/core';
import { Output, generateText } from 'ai';
import { z } from 'zod';
import { normaliseUsage } from './gateway.js';
import { createMockLanguageModel } from './mock/language-model.js';
import { judgePlanner } from './mock/judge-planner.js';
import { costUsdMicros } from './pricing.js';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { withTenant } from '@kora/db';
import { now } from '@kora/core';

const verdictSchema = z.object({
  verdicts: z.array(
    z.object({
      criterionId: z.string(),
      verdict: z.enum(['MET', 'UNMET', 'CANNOT_ASSESS']),
      evidence: z.string().max(300),
    }),
  ),
});

function judgeModel() {
  const env = serverEnv();
  const modelId = env.KORA_MODEL_JUDGE;

  if (modelId.startsWith('mockjudge')) {
    return {
      modelId,
      model: createMockLanguageModel({ modelId, planners: [judgePlanner] }),
    };
  }
  if (modelId.startsWith('claude-')) {
    if (!env.ANTHROPIC_API_KEY) {
      throw new ConfigError(
        'the judge model is an Anthropic model but ANTHROPIC_API_KEY is not set',
        {
          code: 'MISSING_PROVIDER_KEY',
        },
      );
    }
    return { modelId, model: createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(modelId) };
  }
  if (!env.OPENAI_API_KEY) {
    throw new ConfigError('the judge model needs OPENAI_API_KEY', { code: 'MISSING_PROVIDER_KEY' });
  }
  return { modelId, model: createOpenAI({ apiKey: env.OPENAI_API_KEY })(modelId) };
}

/**
 * Temperature 0 and a fixed criterion order, so two runs of the same trace score
 * the same and scores stay comparable across runs.
 */
export function makeJudgeCaller(tenantId: string, runId?: string) {
  return async (call: { system: string; prompt: string; criterionIds: string[] }) => {
    const { model, modelId } = judgeModel();
    const startedAt = Date.now();

    const result = await generateText({
      model: model as never,
      temperature: 0,
      abortSignal: AbortSignal.timeout(20_000),
      output: Output.object({ schema: verdictSchema }),
      system: call.system,
      prompt: call.prompt,
    });

    const usage = normaliseUsage(result.usage);
    const cost = costUsdMicros(modelId, usage) ?? 0;

    await withTenant(tenantId)
      .llmCalls.create({
        runId: runId ?? null,
        purpose: 'judge',
        model: modelId,
        provider: 'judge',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs: Date.now() - startedAt,
        costUsdMicros: cost,
        status: 'ok',
        createdAt: now(),
      })
      .catch(() => {});

    const parsed = verdictSchema.safeParse(result.output);
    return {
      verdicts: parsed.success ? parsed.data.verdicts : [],
      model: modelId,
      costUsdMicros: cost,
    };
  };
}
