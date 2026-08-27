import { KoraError, childLogger, newId } from '@kora/core';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Record<string, string>;

  constructor(status: number, code: string, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export const notFound = (what = 'resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`);
export const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', 'sign in to continue');
export const badRequest = (message: string) => new ApiError(400, 'INVALID_REQUEST', message);
export const conflict = (message: string) => new ApiError(409, 'CONFLICT', message);
export const gone = (message: string) => new ApiError(410, 'GONE', message);

export function rateLimited(retryAfterSeconds: number) {
  return new ApiError(429, 'RATE_LIMITED', 'too many messages, slow down', {
    'Retry-After': String(retryAfterSeconds),
  });
}

export function jsonError(e: unknown, traceId = newId('tr')): Response {
  if (e instanceof ApiError) {
    return Response.json(
      { error: { code: e.code, message: e.message, traceId } },
      { status: e.status, headers: e.headers },
    );
  }

  const code = e instanceof KoraError ? e.code : 'INTERNAL_ERROR';
  childLogger({ traceId }).error({ err: e }, 'unhandled error in an api route');
  return Response.json(
    { error: { code, message: 'something went wrong on our side', traceId } },
    { status: 500 },
  );
}

/**
 * Every route body runs through here so that a thrown `ApiError` and an unexpected
 * crash produce the same response shape, `traceId` included.
 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    return jsonError(e);
  }
}
