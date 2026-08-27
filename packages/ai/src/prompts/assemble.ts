import type { CompiledPolicy } from '@kora/core';
import type { MessageRow } from '@kora/db';
import type { ToolDefinition } from '@kora/tools';
import type { RetrievedChunk } from '../knowledge/search.js';
import { type PromptBlocks, buildSystemPrompt } from './system.js';

export function renderPolicy(policy: CompiledPolicy): string {
  const lines = [
    `${policy.description} (${policy.key} ${policy.version})`,
    `Default when no rule matches: ${policy.default}`,
    '',
    'Rules, in the order they are checked:',
  ];
  for (const rule of policy.rules) {
    const conditions = rule.conditions
      .map((c) => `${c.fact} ${c.op} ${JSON.stringify(c.value)}`)
      .join(' and ');
    lines.push(`- ${rule.id}: ${rule.decision} when ${conditions}. ${rule.reason}`);
  }
  lines.push(
    '',
    'These rules are enforced in code before any action runs. This block is here so you can',
    'explain a decision to the customer, not so you can apply it yourself.',
  );
  return lines.join('\n');
}

export function renderTools(tools: ToolDefinition[]): string {
  return tools.map((t) => `- ${t.name} (${t.sideEffect}): ${t.description}`).join('\n');
}

export function renderKnowledge(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return [
      'Nothing was retrieved for this question.',
      'You do not know the policy. Say you cannot confirm it and hand over to a person.',
      'Do not answer from memory and do not guess.',
    ].join('\n');
  }
  return chunks
    .map(
      (c, i) =>
        `[${i + 1}] ${c.title} — ${c.headingPath} (document ${c.documentId}, version ${c.documentVersion})\n${c.content}`,
    )
    .join('\n\n');
}

export function renderConversation(messages: MessageRow[]): string {
  return messages
    .map((m) => `${m.role === 'customer' ? 'Customer' : 'Agent'}: ${m.content}`)
    .join('\n');
}

export function assemblePrompt(args: {
  policy: CompiledPolicy;
  tools: ToolDefinition[];
  chunks: RetrievedChunk[];
  messages: MessageRow[];
}): string {
  const blocks: PromptBlocks = {
    businessPolicy: renderPolicy(args.policy),
    toolPermissions: renderTools(args.tools),
    retrievedKnowledge: renderKnowledge(args.chunks),
    customerInput: renderConversation(args.messages),
  };
  return buildSystemPrompt(blocks);
}
