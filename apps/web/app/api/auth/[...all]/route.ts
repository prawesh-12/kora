import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';
import { jsonError, rateLimited } from '@/lib/api/errors';
import { takeRouteSlot } from '@/lib/rate-limit';

/**
 * Keyed on the client address because the caller has no session yet.
 * `x-forwarded-for` is only trustworthy behind a proxy that sets it; without one
 * every caller shares the `unknown` bucket, which over-throttles rather than
 * under-throttles, and that is the right way for this to fail.
 */
function callerAddress(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

async function limited(req: Request): Promise<Response | null> {
  try {
    const slot = await takeRouteSlot('auth', callerAddress(req));
    return slot.allowed ? null : jsonError(rateLimited(slot.retryAfterSeconds));
  } catch {
    // Redis being unreachable must not lock everyone out of signing in.
    return null;
  }
}

export const GET = async (req: Request) => (await limited(req)) ?? toNextJsHandler(auth()).GET(req);

export const POST = async (req: Request) =>
  (await limited(req)) ?? toNextJsHandler(auth()).POST(req);
