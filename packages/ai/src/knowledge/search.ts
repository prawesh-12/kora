import { logger, now } from '@kora/core';
import {
  type RunHandle,
  and,
  asc,
  cosineDistance,
  db,
  documentChunks,
  documents,
  eq,
  gt,
  isNull,
  lte,
  or,
  sqlExpr,
} from '@kora/db';
import { embedBatch } from '../embed.js';

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentVersion: number;
  title: string;
  headingPath: string;
  content: string;
  distance: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  stepId: string;
}

export interface RetrieveArgs {
  tenantId: string;
  query: string;
  filters?: { topic?: string | undefined; asOf?: Date };
  topK?: number;
  run?: RunHandle;
}

/**
 * Orders by `cosineDistance` ascending. Ordering by `1 - cosineDistance` descending
 * is logically identical but stops Postgres using the HNSW index.
 */
export async function retrieve(args: RetrieveArgs): Promise<RetrievalResult> {
  const topK = args.topK ?? 5;
  const asOf = args.filters?.asOf ?? now();
  const topic = args.filters?.topic;

  let chunks: RetrievedChunk[] = [];
  let error: string | undefined;

  const startedAt = Date.now();

  try {
    const [embedding] = await embedBatch([args.query], { tenantId: args.tenantId });
    if (!embedding) throw new Error('the query could not be embedded');

    const distance = cosineDistance(documentChunks.embedding, embedding);
    const filters = [
      eq(documentChunks.tenantId, args.tenantId),
      eq(documents.status, 'active'),
      lte(documents.effectiveFrom, asOf),
      or(isNull(documents.effectiveTo), gt(documents.effectiveTo, asOf)),
      ...(topic ? [sqlExpr`${documents.metadata}->>'topic' = ${topic}`] : []),
    ];

    const rows = await db().transaction(async (tx) => {
      await tx.execute(sqlExpr`SET LOCAL hnsw.ef_search = 100`);
      return tx
        .select({
          chunkId: documentChunks.id,
          documentId: documentChunks.documentId,
          documentVersion: documents.version,
          title: documents.title,
          headingPath: documentChunks.headingPath,
          content: documentChunks.content,
          distance,
        })
        .from(documentChunks)
        .innerJoin(documents, eq(documents.id, documentChunks.documentId))
        .where(and(...filters))
        .orderBy(asc(distance))
        .limit(topK);
    });

    chunks = rows.map((r) => ({ ...r, distance: Number(r.distance) }));
  } catch (e) {
    // Never throws into the agent loop: an empty result is a first-class outcome.
    error = (e as Error).message;
    logger().warn({ err: e, query: args.query }, 'retrieval failed');
  }

  const payload = {
    query: args.query,
    filters: { topic: topic ?? null, asOf: asOf.toISOString() },
    chunks,
    ...(error ? { error } : {}),
  };

  const stepId = args.run
    ? await args.run.record('retrieval', payload, error ? 'failed' : 'ok', Date.now() - startedAt)
    : '';
  return { chunks, stepId };
}

export function explainRetrieval(tenantId: string, embedding: number[], topK = 5) {
  const distance = cosineDistance(documentChunks.embedding, embedding);
  return db()
    .select({ id: documentChunks.id, distance })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .where(and(eq(documentChunks.tenantId, tenantId), eq(documents.status, 'active')))
    .orderBy(asc(distance))
    .limit(topK)
    .toSQL();
}
