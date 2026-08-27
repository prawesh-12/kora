import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { unauthorized } from './errors';

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

export async function requireOperator(): Promise<Operator> {
  const operator = await currentOperator();
  if (!operator) throw unauthorized();
  return operator;
}
