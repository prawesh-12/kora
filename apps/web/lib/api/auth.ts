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
 * The single gate every operator route goes through. Rate limiting is keyed on
 * the operator rather than the IP, so one operator behind a shared address is not
 * throttled by a colleague; `/api/auth/*` is keyed by IP for the reverse reason.
 */
export async function requireOperator(): Promise<Operator> {
  const operator = await currentOperator();
  if (!operator) throw unauthorized();

  const slot = await takeRouteSlot('ops', operator.id);
  if (!slot.allowed) throw rateLimited(slot.retryAfterSeconds);

  return operator;
}
