import { closeDb, vrrTrend } from '@kora/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type RunSpec, daysAgo, dropTenant, seedRuns } from './support/seed';

/**
 * The trend line renders one point per day. A chart with a single point is not a
 * chart, and it is worth knowing whether that is the query collapsing the range
 * or the data genuinely covering one day.
 */
const TENANT = 'ten_trend_test';

function runOn(day: number, verified: boolean): RunSpec {
  return {
    intent: 'DAMAGED_ORDER',
    outcome: verified ? 'resolved_automatically' : 'failed',
    finalState: verified ? 'RESOLVED' : 'NEEDS_HUMAN',
    durationMs: 1200,
    costUsdMicros: 120,
    // Mid-afternoon, so a timezone offset cannot push a run into the next day
    // and turn a three-day fixture into a four-point line.
    startedAt: new Date(daysAgo(day).setHours(14, 0, 0, 0)),
    evaluation: { verifiedResolution: verified },
  };
}

beforeAll(async () => {
  await dropTenant(TENANT);
  await seedRuns(TENANT, [
    runOn(3, true),
    runOn(3, true),
    runOn(3, false),
    runOn(2, true),
    runOn(2, false),
    runOn(1, true),
  ]);
});

afterAll(async () => {
  await dropTenant(TENANT);
  await closeDb();
});

describe('the verified resolution trend', () => {
  it('returns one point per day, not one point per range', async () => {
    const trend = await vrrTrend({ tenantId: TENANT, from: daysAgo(4), to: daysAgo(0) });

    expect(trend, 'the query collapsed three days into one point').toHaveLength(3);
    expect(trend.map((p) => p.runs)).toEqual([3, 2, 1]);
  });

  it('gives each day its own denominator', async () => {
    const trend = await vrrTrend({ tenantId: TENANT, from: daysAgo(4), to: daysAgo(0) });

    expect(trend.map((p) => p.verified)).toEqual([2, 1, 1]);
    expect(trend.map((p) => p.rate)).toEqual([2 / 3, 1 / 2, 1]);
  });

  it('returns the days in order, oldest first', async () => {
    const trend = await vrrTrend({ tenantId: TENANT, from: daysAgo(4), to: daysAgo(0) });
    const days = trend.map((p) => p.day);

    expect([...days].sort()).toEqual(days);
  });

  it('returns a single point when the data really is one day', async () => {
    const trend = await vrrTrend({ tenantId: TENANT, from: daysAgo(2), to: daysAgo(1) });
    expect(trend).toHaveLength(1);
  });
});
