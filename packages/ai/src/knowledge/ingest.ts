import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { ConfigError, logger, newId, now, serverEnv } from '@kora/core';
import { db, documentChunks, documents, eq, withTenant } from '@kora/db';
import { embedBatch } from '../embed.js';
import { chunkMarkdown, parseMarkdown } from './chunk.js';

const MAX_FAILED_RATIO = 0.05;

export interface IngestResult {
  documentId: string;
  version: number;
  chunkCount: number;
  skipped: boolean;
}

export async function ingestFile(args: {
  tenantId: string;
  path: string;
  metadata?: Record<string, unknown>;
}): Promise<IngestResult> {
  const source = readFileSync(args.path, 'utf8');
  const checksum = createHash('sha256').update(source).digest('hex');
  const sourceUri = basename(args.path);
  const repos = withTenant(args.tenantId);

  const existing = await repos.documents.findBySourceUri(sourceUri);
  const active = existing.find((d) => d.status === 'active');
  if (active?.checksum === checksum) {
    return { documentId: active.id, version: active.version, chunkCount: 0, skipped: true };
  }

  const { frontmatter, body } = parseMarkdown(source);
  const chunks = chunkMarkdown(body);
  if (chunks.length === 0) {
    throw new ConfigError(`${sourceUri} produced no chunks`, { code: 'EMPTY_DOCUMENT' });
  }

  const embeddings = await embedBatch(
    chunks.map((c) => c.content),
    { tenantId: args.tenantId },
  );
  const failed = embeddings.filter((e) => e === null).length;
  if (failed / chunks.length > MAX_FAILED_RATIO) {
    throw new ConfigError(
      `${failed} of ${chunks.length} chunks failed to embed for ${sourceUri}, aborting the ingest`,
      { code: 'EMBEDDING_FAILED' },
    );
  }

  const dimensions = serverEnv().KORA_EMBEDDING_DIMENSIONS;
  for (const e of embeddings) {
    if (e && e.length !== dimensions) {
      throw new ConfigError(
        `embedding has ${e.length} dimensions, the schema declares ${dimensions}`,
        { code: 'EMBEDDING_DIMENSION_MISMATCH' },
      );
    }
  }

  const version = (existing[0]?.version ?? 0) + 1;
  const documentId = newId('doc');

  // Insert the new version, fill it, then swap in one transaction. Retrieval must
  // never see a half-indexed document.
  await db().transaction(async (tx) => {
    await tx.insert(documents).values({
      id: documentId,
      tenantId: args.tenantId,
      title: frontmatter.title ?? sourceUri,
      sourceType: extname(args.path) === '.pdf' ? 'pdf' : 'markdown',
      sourceUri,
      status: 'processing',
      version,
      effectiveFrom: now(),
      metadata: { ...frontmatter, ...args.metadata },
      checksum,
      createdAt: now(),
    });

    const rows = chunks
      .map((c, i) => ({ c, embedding: embeddings[i] }))
      .filter((r): r is { c: (typeof chunks)[number]; embedding: number[] } => r.embedding !== null)
      .map((r) => ({
        id: newId('chk'),
        tenantId: args.tenantId,
        documentId,
        ordinal: r.c.ordinal,
        content: r.c.content,
        tokenCount: r.c.tokenCount,
        headingPath: r.c.headingPath,
        embedding: r.embedding,
        createdAt: now(),
      }));

    // A chunk row carries a 1536-element vector and Postgres caps a statement at
    // 65,535 bound parameters.
    for (let i = 0; i < rows.length; i += 200) {
      await tx.insert(documentChunks).values(rows.slice(i, i + 200));
    }

    for (const old of existing) {
      if (old.status === 'active') {
        await tx
          .update(documents)
          .set({ status: 'superseded', effectiveTo: now() })
          .where(eq(documents.id, old.id));
      }
    }
    await tx.update(documents).set({ status: 'active' }).where(eq(documents.id, documentId));
  });

  return { documentId, version, chunkCount: chunks.length, skipped: false };
}

export async function ingestDirectory(args: {
  tenantId: string;
  dir: string;
}): Promise<IngestResult[]> {
  const files = readdirSync(args.dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(args.dir, f))
    .filter((f) => statSync(f).isFile())
    .sort();

  const results: IngestResult[] = [];
  for (const path of files) {
    const result = await ingestFile({ tenantId: args.tenantId, path });
    logger().info(
      { file: basename(path), ...result },
      result.skipped ? 'knowledge unchanged' : 'knowledge ingested',
    );
    results.push(result);
  }
  return results;
}
