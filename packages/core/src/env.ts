import { z } from 'zod';
import { ConfigError } from './errors.js';

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  /**
   * The runtime connection. Points at a non-superuser role so row-level security
   * is actually enforced; migrations keep using DATABASE_URL as the owner.
   */
  DATABASE_APP_URL: z.string().optional(),
  REDIS_URL: z.string().min(1),
  KORA_APP_URL: z.string().url().default('http://localhost:3000'),
  KORA_TENANT_ID: z.string().min(1).default('ten_acme'),

  BETTER_AUTH_SECRET: z.string().min(16).default('kora-development-secret-change-me'),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
  KORA_SEED_OPERATOR_EMAIL: z.string().email().default('operator@acme.test'),
  KORA_SEED_OPERATOR_PASSWORD: z.string().min(8).default('operator-password'),

  KORA_MODEL_PROVIDER: z.enum(['mock', 'openai', 'anthropic']).default('mock'),
  KORA_MODEL_AGENT: z.string().min(1).default('mock-agent'),
  KORA_MODEL_CLASSIFIER: z.string().min(1).default('mock-classifier'),
  KORA_MODEL_EMBEDDING: z.string().min(1).default('mock-embedding'),
  KORA_MODEL_AGENT_FALLBACK: z.string().min(1).optional(),
  KORA_MODEL_JUDGE: z.string().min(1).default('mockjudge-v1'),
  KORA_JUDGE_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.2),
  KORA_RUBRIC_VERSION: z.string().min(1).default('support-v1'),
  KORA_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  KORA_MAX_STEPS: z.coerce.number().int().positive().default(8),
  KORA_RUN_DEADLINE_MS: z.coerce.number().int().positive().default(45000),
  KORA_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  KORA_APPROVAL_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  KORA_ALERT_WEBHOOK_URL: z.string().url().optional(),
  KORA_APPROVAL_WEBHOOK_URL: z.string().url().optional(),
  /** Encrypts business API credentials at rest. Rotatable without a redeploy. */
  KORA_SECRET_KEY: z.string().min(16).optional(),
  /** Stripe webhook endpoint secret: raw `whsec_…` or a `v1.…` blob from encryptSecret. */
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  KORA_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  KORA_REFUND_WINDOW_DAYS: z.coerce.number().int().positive().default(30),
  STRIPE_DEV_KEY: z.string().min(1).optional(),
  STRIPE_TENANT_KEY: z.string().min(1).optional(),
  STRIPE_FIXTURE_FROZEN_TIME: z.string().min(1).optional(),
  STRIPE_PRICE_BASIC: z.string().min(1).optional(),
  STRIPE_PRICE_PRO: z.string().min(1).optional(),
  KORA_DEPLOYMENT_MODE: z
    .enum(['simulation', 'shadow', 'human_approval', 'limited', 'full'])
    .default('full'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  // A key left blank in a .env file arrives as an empty string, not as absent, so
  // every optional setting would fail its own min length. `.env.example` ships the
  // optional keys blank, which is the shape a first setup copies.
  const present: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== '') present[key] = value;
  }

  const parsed = serverSchema.safeParse(present);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid environment:\n${problems}`, {
      code: 'INVALID_ENV',
      context: { issues: parsed.error.issues },
    });
  }
  return parsed.data;
}

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (!cached) cached = parseServerEnv(process.env);
  return cached;
}

export function publicEnv() {
  return { appUrl: serverEnv().KORA_APP_URL };
}
