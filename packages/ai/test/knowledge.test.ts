import { join } from 'node:path';
import { now } from '@kora/core';
import { and, closeDb, db, documents, eq, sql } from '@kora/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  chunkMarkdown,
  countTokens,
  parseMarkdown,
  splitIntoSections,
} from '../src/knowledge/chunk.js';
import { ingestDirectory } from '../src/knowledge/ingest.js';
import { retrieve } from '../src/knowledge/search.js';
import { mockEmbedding } from '../src/embed.js';

const TENANT = 'ten_knowledge_test';
const KNOWLEDGE_DIR = join(import.meta.dirname, '../../../config/knowledge');

const SAMPLE = `---
title: Sample
topic: returns
---

# Returns

Some general text about returns that sets the scene for the reader.

## Damaged items

### Eligibility

Replacements are available for 7 days from delivery. The seven days are counted
from the delivery date recorded on the order.

An order that has not been delivered cannot be reported as damaged.
`;

beforeAll(async () => {
  await sql()`INSERT INTO tenants (id, name) VALUES (${TENANT}, 'Knowledge test')
              ON CONFLICT (id) DO NOTHING`;
  await ingestDirectory({ tenantId: TENANT, dir: KNOWLEDGE_DIR });
});

afterAll(async () => {
  await sql()`DELETE FROM document_chunks WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM documents WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM llm_calls WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM tenants WHERE id = ${TENANT}`;
  await closeDb();
});

describe('chunking', () => {
  it('reads frontmatter and leaves it out of the body', () => {
    const { frontmatter, body } = parseMarkdown(SAMPLE);
    expect(frontmatter.title).toBe('Sample');
    expect(frontmatter.topic).toBe('returns');
    expect(body).not.toContain('title: Sample');
  });

  it('builds a heading path that reflects the hierarchy', () => {
    const sections = splitIntoSections(parseMarkdown(SAMPLE).body);
    const paths = sections.map((s) => s.headingPath);
    expect(paths).toContain('Returns');
    expect(paths).toContain('Returns > Damaged items > Eligibility');
  });

  it('never splits a chunk mid-sentence', () => {
    for (const chunk of chunkMarkdown(parseMarkdown(SAMPLE).body)) {
      const body = chunk.content.replace(`${chunk.headingPath}\n\n`, '').trim();
      expect(body.length).toBeGreaterThan(0);
      expect(/[.!?:)\]]$/.test(body)).toBe(true);
    }
  });

  it('keeps the number 7 with the sentence it belongs to', () => {
    const chunks = chunkMarkdown(parseMarkdown(SAMPLE).body);
    const withSeven = chunks.find((c) => c.content.includes('7 days'));
    expect(withSeven?.content).toContain('Replacements are available for 7 days from delivery');
  });

  it('keeps every chunk within the token target', () => {
    for (const chunk of chunkMarkdown(parseMarkdown(SAMPLE).body)) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(550);
      expect(chunk.tokenCount).toBe(countTokens(chunk.content));
    }
  });

  it('carries the heading path into every chunk of a section', () => {
    const chunks = chunkMarkdown(parseMarkdown(SAMPLE).body);
    for (const c of chunks) {
      if (c.headingPath) expect(c.content.startsWith(c.headingPath)).toBe(true);
    }
  });
});

describe('ingest', () => {
  it('creates exactly one active version per document', async () => {
    const rows = await sql()<{ source_uri: string; n: string }[]>`
      SELECT source_uri, count(*) AS n FROM documents
      WHERE tenant_id = ${TENANT} AND status = 'active' GROUP BY source_uri`;
    expect(rows.length).toBe(3);
    for (const r of rows) expect(Number(r.n)).toBe(1);
  });

  it('gives every chunk an embedding and a heading path', async () => {
    const [row] = await sql()<{ total: string; embedded: string; headed: string }[]>`
      SELECT count(*) AS total,
             count(embedding) AS embedded,
             count(*) FILTER (WHERE heading_path <> '') AS headed
      FROM document_chunks WHERE tenant_id = ${TENANT}`;
    expect(Number(row?.total)).toBeGreaterThan(0);
    expect(Number(row?.embedded)).toBe(Number(row?.total));
    expect(Number(row?.headed)).toBe(Number(row?.total));
  });

  it('creates zero new rows when nothing changed', async () => {
    const before = await sql()`SELECT id FROM document_chunks WHERE tenant_id = ${TENANT}`;
    const results = await ingestDirectory({ tenantId: TENANT, dir: KNOWLEDGE_DIR });
    expect(results.every((r) => r.skipped)).toBe(true);
    const after = await sql()`SELECT id FROM document_chunks WHERE tenant_id = ${TENANT}`;
    expect(after.length).toBe(before.length);
  });
});

describe('retrieval', () => {
  it('finds the damaged item policy for a damaged item question', async () => {
    const { chunks } = await retrieve({
      tenantId: TENANT,
      query: 'my item arrived damaged, can I get a replacement',
      filters: { topic: 'returns' },
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.content.includes('7 days'))).toBe(true);
    expect(chunks[0]?.distance).toBeLessThanOrEqual(chunks.at(-1)?.distance ?? 1);
  });

  it('never returns a superseded version', async () => {
    const active = await db().select().from(documents).where(eq(documents.tenantId, TENANT));
    const target = active.find((d) => d.sourceUri === 'acme-damaged-items.md');
    await db().update(documents).set({ status: 'superseded' }).where(eq(documents.id, target!.id));

    const { chunks } = await retrieve({ tenantId: TENANT, query: 'damaged item replacement' });
    expect(chunks.every((c) => c.documentId !== target!.id)).toBe(true);

    await db().update(documents).set({ status: 'active' }).where(eq(documents.id, target!.id));
  });

  it('excludes a document whose effective_to has passed', async () => {
    const [target] = await db()
      .select()
      .from(documents)
      .where(and(eq(documents.tenantId, TENANT), eq(documents.status, 'active')));
    await db()
      .update(documents)
      .set({ effectiveTo: new Date(now().getTime() - 86_400_000) })
      .where(eq(documents.id, target!.id));

    const { chunks } = await retrieve({ tenantId: TENANT, query: 'damaged item replacement' });
    expect(chunks.every((c) => c.documentId !== target!.id)).toBe(true);

    await db().update(documents).set({ effectiveTo: null }).where(eq(documents.id, target!.id));
  });

  it('never returns a half-indexed document', async () => {
    const [target] = await db()
      .select()
      .from(documents)
      .where(and(eq(documents.tenantId, TENANT), eq(documents.status, 'active')));
    await db().update(documents).set({ status: 'processing' }).where(eq(documents.id, target!.id));

    const { chunks } = await retrieve({ tenantId: TENANT, query: 'damaged item replacement' });
    expect(chunks.every((c) => c.documentId !== target!.id)).toBe(true);

    await db().update(documents).set({ status: 'active' }).where(eq(documents.id, target!.id));
  });

  it('returns an empty result rather than throwing when nothing matches the filter', async () => {
    const { chunks } = await retrieve({
      tenantId: TENANT,
      query: 'damaged item replacement',
      filters: { topic: 'a-topic-that-does-not-exist' },
    });
    expect(chunks).toEqual([]);
  });

  it('orders in a way the hnsw index can serve, unlike 1 - cosineDistance', async () => {
    const vector = `[${mockEmbedding('damaged item replacement policy', 1536).join(',')}]`;

    // With ten rows the planner picks a sequential scan whatever the query says,
    // because it is genuinely cheaper. Turning it off asks the question that
    // actually matters: can this ordering use the index at all?
    const planFor = (orderBy: string) =>
      sql().begin(async (tx) => {
        await tx.unsafe('SET LOCAL enable_seqscan = off');
        const rows = await tx.unsafe(
          `EXPLAIN SELECT c.id FROM document_chunks c ORDER BY ${orderBy} LIMIT 5`,
        );
        return (rows as unknown as Array<Record<string, string>>)
          .map((r) => r['QUERY PLAN'] ?? '')
          .join('\n');
      });

    const correct = await planFor(`c.embedding <=> '${vector}'::vector`);
    const broken = await planFor(`1 - (c.embedding <=> '${vector}'::vector) DESC`);

    expect(correct).toContain('document_chunks_embedding_idx');
    expect(correct).toContain('Index Scan');
    expect(broken).not.toContain('document_chunks_embedding_idx');
  });
});
