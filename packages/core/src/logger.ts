import { pino } from 'pino';
import type { Logger as PinoLogger } from 'pino';
import { serverEnv } from './env.js';

const REDACT = [
  'authorization',
  'apiKey',
  'api_key',
  'token',
  'password',
  'email',
  'phone',
  'address',
  '*.authorization',
  '*.apiKey',
  '*.token',
  '*.password',
  '*.email',
  '*.phone',
  '*.address',
];

/**
 * Pretty logging runs pino-pretty in a worker thread, which a bundler cannot
 * follow: inside Next it fails to resolve and takes the dev server down. It is
 * opt-in for that reason, and JSON is the default everywhere.
 */
function create() {
  const env = serverEnv();
  const pretty = env.LOG_PRETTY && env.NODE_ENV === 'development';
  return pino({
    level: env.LOG_LEVEL,
    redact: { paths: REDACT, censor: '[redacted]' },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  });
}

let root: PinoLogger | null = null;

export type Logger = PinoLogger;

export function logger(): Logger {
  if (!root) root = create();
  return root;
}

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger().child(bindings);
}
