import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { config } from 'dotenv';

config({ path: join(import.meta.dirname, '.env'), quiet: true });

function isMain(url: string): boolean {
  return process.argv[1] !== undefined && url === pathToFileURL(process.argv[1]).href;
}

export interface StripeFixturesResult {
  tenantId: string;
  backend: 'live' | 'stub';
  created: boolean;
  testClockId: string;
  customers: number;
  subscriptions: number;
  charges: number;
  liveAttempted: boolean;
  liveSkippedReason: string | null;
}

export async function runStripeFixtures(tenantId?: string): Promise<StripeFixturesResult> {
  const { serverEnv, logger } = await import('@kora/core');
  const { closeDb, getStripeFixtures, saveStripeFixtures } = await import('@kora/db');
  const { ensureStripeFixtures, STUB_FROZEN_TIME, StubFixtureBackend } = await import(
    '@kora/tools'
  );
  const log = logger();
  const env = serverEnv();
  const tenant = tenantId ?? env.KORA_TENANT_ID;
  const frozenTime = env.STRIPE_FIXTURE_FROZEN_TIME ?? STUB_FROZEN_TIME;
  const windowDays = env.KORA_REFUND_WINDOW_DAYS;
  const priceIds = {
    basic: env.STRIPE_PRICE_BASIC ?? 'price_stub_basic',
    pro: env.STRIPE_PRICE_PRO ?? 'price_stub_pro',
  };

  const store = {
    load: (t: string) => getStripeFixtures(t),
    save: (t: string, manifest: Record<string, unknown>) =>
      saveStripeFixtures(t, manifest).then(() => {}),
  };

  const devKey = env.STRIPE_DEV_KEY;
  if (devKey) {
    let stripeMod: unknown = null;
    try {
      stripeMod = await import('stripe');
    } catch {
      stripeMod = null;
    }
    if (!stripeMod) {
      log.warn(
        { tenantId: tenant },
        'STRIPE_DEV_KEY is set but the stripe package is not installed, so live fixtures were skipped',
      );
    } else {
      log.warn(
        { tenantId: tenant },
        'live Stripe fixtures are not implemented in this phase, falling back to the stub backend',
      );
    }
  }

  const backend = new StubFixtureBackend();
  try {
    const { manifest, created } = await ensureStripeFixtures({
      tenantId: tenant,
      backend,
      store,
      frozenTime,
      windowDays,
      priceIds,
    });
    return {
      tenantId: tenant,
      backend: manifest.backend,
      created,
      testClockId: manifest.testClockId,
      customers: manifest.customers.length,
      subscriptions: manifest.subscriptions.length,
      charges: manifest.charges.length,
      liveAttempted: Boolean(devKey),
      liveSkippedReason: devKey
        ? 'live backend not implemented in this phase'
        : 'STRIPE_DEV_KEY is not set',
    };
  } finally {
    await closeDb().catch(() => {});
  }
}

if (isMain(import.meta.url)) {
  runStripeFixtures()
    .then((r) => {
      console.log(
        `stripe fixtures ${r.created ? 'created' : 'reused'} for ${r.tenantId}: clock=${r.testClockId} customers=${r.customers} subscriptions=${r.subscriptions} charges=${r.charges} backend=${r.backend}`,
      );
      if (r.liveSkippedReason) console.log(`live run skipped: ${r.liveSkippedReason}`);
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    });
}
