import { eq } from 'drizzle-orm';
import { type Database, db } from '../client.js';
import * as s from '../schema/index.js';

/** The name the customer sees in the chat header. */
export async function tenantName(tenantId: string, conn: Database = db()): Promise<string | null> {
  const [row] = await conn
    .select({ name: s.tenants.name })
    .from(s.tenants)
    .where(eq(s.tenants.id, tenantId));
  return row?.name ?? null;
}
