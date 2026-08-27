import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type CompiledPolicy, ConfigError, compilePolicyBundle, serverEnv } from '@kora/core';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';

const schema = z
  .object({
    version: z.string(),
    maxSteps: z.number().int().positive(),
    runDeadlineMs: z.number().int().positive(),
    confidenceThreshold: z.number().min(0).max(1),
    allowedTools: z.array(z.object({ name: z.string(), version: z.number().int() })).min(1),
    permissions: z.array(z.string()).min(1),
    policyBundle: z.array(z.string()).min(1),
  })
  .strict();

export interface AgentConfig extends z.infer<typeof schema> {
  /** sha256 of the config file, recorded on every run as `agent_config_version`. */
  configVersion: string;
  compiledPolicy: CompiledPolicy;
}

const REPO_ROOT = join(import.meta.dirname, '../../..');

let cached: AgentConfig | null = null;

export function loadAgentConfig(path = join(REPO_ROOT, 'config/agent.yaml')): AgentConfig {
  if (cached) return cached;

  const source = readFileSync(path, 'utf8');
  const parsed = schema.safeParse(parseYaml(source));
  if (!parsed.success) {
    throw new ConfigError(
      `invalid agent config:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
      { code: 'AGENT_CONFIG_INVALID' },
    );
  }

  assertJudgeFamily();

  const compiledPolicy = compilePolicyBundle(
    parsed.data.policyBundle.map((file) => ({
      key: basename(file, '.yaml'),
      yaml: readFileSync(join(REPO_ROOT, file), 'utf8'),
    })),
  );
  cached = {
    ...parsed.data,
    configVersion: createHash('sha256').update(source).digest('hex').slice(0, 16),
    compiledPolicy,
  };
  return cached;
}

export function resetAgentConfig(): void {
  cached = null;
}

function familyOf(modelId: string): string {
  const id = modelId.toLowerCase();
  if (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3')) return 'openai';
  if (id.startsWith('claude-')) return 'anthropic';
  if (id.startsWith('gemini-')) return 'google';
  if (id.startsWith('mockjudge')) return 'kora-mock-judge';
  if (id.startsWith('mock')) return 'kora-mock';
  return id.split('-')[0] ?? id;
}

/**
 * Checked at config load, not at first use. A judge from the same family as the
 * agent systematically over-rewards its own outputs, and the failure mode is a
 * dashboard reading 94% for three months while the agent is quietly wrong.
 */
export function assertJudgeFamily(): void {
  const env = serverEnv();
  if (familyOf(env.KORA_MODEL_JUDGE) === familyOf(env.KORA_MODEL_AGENT)) {
    throw new ConfigError(
      `KORA_MODEL_JUDGE (${env.KORA_MODEL_JUDGE}) is the same family as KORA_MODEL_AGENT (${env.KORA_MODEL_AGENT}). The judge must be a different family.`,
      { code: 'JUDGE_SAME_FAMILY' },
    );
  }
}
