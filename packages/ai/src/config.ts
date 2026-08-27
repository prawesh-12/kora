import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CompiledPolicy, ConfigError, compilePolicy } from '@kora/core';
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
    policy: z.string(),
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

  const compiledPolicy = compilePolicy(readFileSync(join(REPO_ROOT, parsed.data.policy), 'utf8'));
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
