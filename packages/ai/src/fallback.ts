import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { ConfigError, serverEnv } from '@kora/core';
import type { LanguageModel } from 'ai';
import { DEFAULT_PLANNERS } from './mock/planners.js';
import { createMockLanguageModel } from './mock/language-model.js';

export interface FallbackModel {
  modelId: string;
  model: LanguageModel;
  provider: string;
}

let override: string | null = null;

/**
 * Mirrors `setMockPlanners`: lets a test drive the fallback path without restarting
 * the process to change `KORA_MODEL_AGENT_FALLBACK`.
 */
export function setFallbackModel(modelId: string | null): void {
  override = modelId;
}

function build(modelId: string): FallbackModel {
  const env = serverEnv();

  if (modelId.startsWith('mock')) {
    return {
      modelId,
      provider: 'mock',
      model: createMockLanguageModel({
        modelId,
        planners: DEFAULT_PLANNERS,
      }) as unknown as LanguageModel,
    };
  }
  if (modelId.startsWith('claude-')) {
    if (!env.ANTHROPIC_API_KEY) {
      throw new ConfigError(
        'KORA_MODEL_AGENT_FALLBACK is an Anthropic model but ANTHROPIC_API_KEY is not set',
        { code: 'MISSING_PROVIDER_KEY' },
      );
    }
    return {
      modelId,
      provider: 'anthropic',
      model: createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(modelId),
    };
  }
  if (!env.OPENAI_API_KEY) {
    throw new ConfigError('KORA_MODEL_AGENT_FALLBACK needs OPENAI_API_KEY', {
      code: 'MISSING_PROVIDER_KEY',
    });
  }
  return {
    modelId,
    provider: 'openai',
    model: createOpenAI({ apiKey: env.OPENAI_API_KEY })(modelId),
  };
}

/**
 * The judge has no fallback and cannot be given one. Swapping the judge model changes
 * what the scores mean, so every number recorded before the swap stops being
 * comparable with every number after it, and the calibration set no longer applies.
 * That is enforced here rather than left to a convention: the only role that resolves
 * to a fallback is `agent`, and a fallback id belonging to the judge is rejected.
 */
export function fallbackModelFor(purpose: 'agent' | 'classifier'): FallbackModel | null {
  if (purpose !== 'agent') return null;

  const env = serverEnv();
  const modelId = override ?? env.KORA_MODEL_AGENT_FALLBACK;
  if (!modelId) return null;

  if (modelId === env.KORA_MODEL_JUDGE || modelId.startsWith('mockjudge')) {
    throw new ConfigError(
      `KORA_MODEL_AGENT_FALLBACK (${modelId}) is the judge model. The judge is never used as an agent fallback.`,
      { code: 'FALLBACK_IS_JUDGE' },
    );
  }
  return build(modelId);
}
