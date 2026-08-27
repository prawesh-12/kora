import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { ConfigError, serverEnv } from '@kora/core';
import type { LanguageModel } from 'ai';
import { createMockLanguageModel } from './mock/language-model.js';
import { DEFAULT_PLANNERS, type MockPlanner } from './mock/index.js';

export type ModelPurpose = 'agent' | 'classifier' | 'embedding';

function modelIdFor(purpose: ModelPurpose): string {
  const env = serverEnv();
  return purpose === 'agent'
    ? env.KORA_MODEL_AGENT
    : purpose === 'classifier'
      ? env.KORA_MODEL_CLASSIFIER
      : env.KORA_MODEL_EMBEDDING;
}

let extraPlanners: MockPlanner[] = [];

/**
 * Lets a test push a planner in front of the default ones so it can force a
 * specific model behaviour without stubbing the whole gateway.
 */
export function setMockPlanners(planners: MockPlanner[]): void {
  extraPlanners = planners;
}

export function providerName(): string {
  return serverEnv().KORA_MODEL_PROVIDER;
}

export function getModel(purpose: 'agent' | 'classifier'): LanguageModel {
  const env = serverEnv();
  const modelId = modelIdFor(purpose);

  switch (env.KORA_MODEL_PROVIDER) {
    case 'mock':
      return createMockLanguageModel({
        modelId,
        planners: [...extraPlanners, ...DEFAULT_PLANNERS],
      }) as unknown as LanguageModel;

    case 'openai': {
      if (!env.OPENAI_API_KEY) {
        throw new ConfigError('KORA_MODEL_PROVIDER=openai but OPENAI_API_KEY is not set', {
          code: 'MISSING_PROVIDER_KEY',
        });
      }
      return createOpenAI({ apiKey: env.OPENAI_API_KEY })(modelId);
    }

    case 'anthropic': {
      if (!env.ANTHROPIC_API_KEY) {
        throw new ConfigError('KORA_MODEL_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set', {
          code: 'MISSING_PROVIDER_KEY',
        });
      }
      return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(modelId);
    }
  }
}

export function getEmbeddingModelId(): string {
  return modelIdFor('embedding');
}
