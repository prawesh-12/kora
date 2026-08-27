import type { HttpBindings } from '@hono/node-server';
import { serverEnv } from '@kora/core';
import type { Context, MiddlewareHandler } from 'hono';

export const faults = ['timeout', '500', 'slow', 'malformed', 'duplicate', 'stale'] as const;

export type Fault = (typeof faults)[number];

export interface AppEnv {
  Variables: {
    fault: Fault | null;
    idempotencyKey: string | null;
    reachedBusinessLogic: boolean;
  };
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SLOW_MS = 4_000;

// Random injection only picks transport faults. The write faults change stored state, so
// firing them at random would make every read path non-deterministic.
const randomFaults: Fault[] = ['timeout', '500', 'slow'];

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFault(value: string): value is Fault {
  return (faults as readonly string[]).includes(value);
}

export function requestedFault(c: Context<AppEnv>): Fault | null {
  const header = c.req.header('x-acme-fault');
  if (header) return isFault(header) ? header : null;
  const rate = serverEnv().ACME_FAULT_RATE;
  if (rate <= 0 || Math.random() >= rate) return null;
  return randomFaults[Math.floor(Math.random() * randomFaults.length)] ?? '500';
}

function faultDelayMs(c: Context<AppEnv>, fallback: number): number {
  const header = c.req.header('x-acme-fault-delay-ms');
  const parsed = header === undefined ? Number.NaN : Number(header);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function holdThenClose(c: Context<AppEnv>): Promise<Response> {
  await delay(faultDelayMs(c, DEFAULT_TIMEOUT_MS));
  const bindings = c.env as HttpBindings | undefined;
  bindings?.incoming.socket?.destroy();
  return c.body(null, 504);
}

export const faultInjection: MiddlewareHandler<AppEnv> = async (c, next) => {
  const fault = requestedFault(c);
  c.set('fault', fault);
  switch (fault) {
    case 'timeout':
      return holdThenClose(c);
    case '500':
      return c.json({ error: { code: 'INTERNAL', message: 'acme upstream failure' } }, 500);
    case 'slow':
      await delay(faultDelayMs(c, DEFAULT_SLOW_MS));
      return next();
    case 'malformed':
      return c.json({ id: 12345, orderId: null });
    default:
      return next();
  }
};
