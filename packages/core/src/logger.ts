import { pino } from 'pino';
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

function create() {
  const env = serverEnv();
  const dev = env.NODE_ENV === 'development';
  return pino({
    level: env.LOG_LEVEL,
    redact: { paths: REDACT, censor: '[redacted]' },
    ...(dev ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  });
}

let root: pino.Logger | null = null;

export type Logger = pino.Logger;

export function logger(): Logger {
  if (!root) root = create();
  return root;
}

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger().child(bindings);
}
