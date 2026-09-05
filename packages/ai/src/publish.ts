import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { logger, serverEnv } from '@kora/core';
import {
  activate,
  activePolicyVersionIds,
  createDraft,
  ensureAgent,
  publishPolicy,
} from '@kora/db';
import { INTENT_SYSTEM_PROMPT } from './prompts/intent.js';
import { SYSTEM_POLICY } from './prompts/system.js';
import { loadAgentConfig } from './config.js';

const REPO_ROOT = join(import.meta.dirname, '../../..');

/**
 * `config/agent.yaml` and `config/policies/*.yaml` stay in the repository as the
 * source a human edits and reviews. Publishing is what makes a version real: from
 * then on the runtime reads the database, and nothing reads the file.
 */
export async function publishFromFiles(actorId?: string): Promise<{
  agentVersionId: string;
  policyVersionIds: string[];
}> {
  const tenantId = serverEnv().KORA_TENANT_ID;
  const config = loadAgentConfig();
  const log = logger();

  const keys: string[] = [];
  for (const file of config.policyBundle) {
    const yaml = readFileSync(join(REPO_ROOT, file), 'utf8');
    const published = await publishPolicy(tenantId, basename(file, '.yaml'), yaml);
    keys.push(published.key);
    log.info({ key: published.key, version: published.version }, 'policy published');
  }

  const policyVersionIds = await activePolicyVersionIds(tenantId, keys);
  const agentId = await ensureAgent(tenantId, 'support', 'Acme Support');

  const draft = await createDraft(
    tenantId,
    agentId,
    {
      model: serverEnv().KORA_MODEL_AGENT,
      systemPrompt: SYSTEM_POLICY,
      intentPrompt: INTENT_SYSTEM_PROMPT,
      allowedTools: config.allowedTools,
      permissions: config.permissions,
      policyBundle: policyVersionIds,
      rubricVersion: serverEnv().KORA_RUBRIC_VERSION,
      maxSteps: config.maxSteps,
      runDeadlineMs: config.runDeadlineMs,
      confidenceThreshold: config.confidenceThreshold,
    },
    actorId,
  );

  const activated = await activate(tenantId, draft.id, actorId ?? 'system');
  log.info({ versionId: activated.id, version: activated.version }, 'agent version activated');

  return { agentVersionId: activated.id, policyVersionIds };
}
