import { index, integer, jsonb, pgTable, text, timestamp, vector } from 'drizzle-orm/pg-core';

export const EMBEDDING_DIMENSIONS = 1536;

export const documents = pgTable(
  'documents',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    title: text('title').notNull(),
    sourceType: text('source_type').notNull(),
    sourceUri: text('source_uri').notNull(),
    status: text('status').notNull(),
    version: integer('version').notNull().default(1),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    checksum: text('checksum').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('documents_tenant_idx').on(t.tenantId),
    index('documents_tenant_status_idx').on(t.tenantId, t.status),
    index('documents_source_uri_idx').on(t.tenantId, t.sourceUri),
  ],
);

export const documentChunks = pgTable(
  'document_chunks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull(),
    headingPath: text('heading_path').notNull().default(''),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('document_chunks_tenant_doc_idx').on(t.tenantId, t.documentId),
    index('document_chunks_embedding_idx')
      .using('hnsw', t.embedding.op('vector_cosine_ops'))
      .with({ m: 16, ef_construction: 64 }),
  ],
);
