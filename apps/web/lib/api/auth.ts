import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { takeRouteSlot } from '@/lib/rate-limit';
import { rateLimited, unauthorized } from './errors';

export interface Operator {
  id: string;
  name: string;
  email: string;
}

export async function currentOperator(): Promise<Operator | null> {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const { id, name, email } = session.user;
  return { id, name, email };
}

/**
 * The single gate every operator route goes through, so the rate limit is applied
 * here rather than remembered in each handler.
 *
 * Keyed on the operator, not the IP: an operator behind a shared address should
 * not be throttled by a colleague, and an unauthenticated caller never gets this
 * far. `/api/auth/*` has its own, tighter limit for the same reason in reverse.
 */
export async function requireOperator(): Promise<Operator> {
  const operator = await currentOperator();
  if (!operator) throw unauthorized();

  const slot = await takeRouteSlot('ops', operator.id);
  if (!slot.allowed) throw rateLimited(slot.retryAfterSeconds);

  return operator;
}
