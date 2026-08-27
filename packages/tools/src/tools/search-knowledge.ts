import { ToolError } from '@kora/core';
import { z } from 'zod';
import { defineTool } from '../registry.js';

export const searchKnowledge = defineTool({
  name: 'search_knowledge',
  version: 1,
  description:
    'Use this when you need the current business policy before telling the customer what can or cannot be done. Never answer a policy question from memory.',
  inputSchema: z.object({
    query: z.string().min(1),
    topic: z.string().optional(),
    topK: z.number().int().min(1).max(10).default(5),
  }),
  outputSchema: z.object({
    chunks: z.array(
      z.object({
        chunkId: z.string(),
        documentId: z.string(),
        documentVersion: z.number().int(),
        title: z.string(),
        headingPath: z.string(),
        content: z.string(),
        distance: z.number(),
      }),
    ),
  }),
  sideEffect: 'read',
  rerunOnReplay: true,
  requiredPermission: 'knowledge:read',
  timeoutMs: 6000,
  maxRetries: 2,
  idempotent: true,
  inputExamples: [
    { input: { query: 'damaged item replacement policy', topic: 'returns', topK: 5 } },
  ],
  async execute(input, ctx) {
    if (!ctx.searchKnowledge) {
      throw new ToolError('no knowledge searcher was wired into the tool context', {
        code: 'INVALID_INPUT',
        retryable: false,
      });
    }
    return ctx.searchKnowledge({ query: input.query, topic: input.topic, topK: input.topK });
  },
});
