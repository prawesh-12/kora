import { childLogger } from '@kora/core';
import type { EventJob } from '../queues.js';

export async function ingestDocumentJob(job: EventJob): Promise<void> {
  const { tenantId, documentId, chunkCount } = job.payload as {
    tenantId: string;
    documentId: string;
    chunkCount: number;
  };
  childLogger({ tenantId, documentId }).info({ chunkCount }, 'document indexed');
}
