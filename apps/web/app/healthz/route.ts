export const dynamic = 'force-dynamic';

/**
 * Deliberately imports nothing: a liveness probe that fails when Postgres is slow
 * takes the fleet out of rotation for a problem restarting the process cannot fix.
 */
export function GET(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
}
