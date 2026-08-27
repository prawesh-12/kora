import { serverEnv } from '@kora/core';
import { closeDb } from '@kora/db';
import { afterAll, describe, expect, it } from 'vitest';
import { ALERT_RULES, type AlertResult, evaluateAlerts, renderAlerts } from '../src/alerts.js';

afterAll(closeDb);

/**
 * Routes that exist in `apps/web/app`. Kept here rather than read off the file
 * system because `evaluation` must not reach into the web app, and a drill path
 * that 404s is the same as no drill path at all.
 */
const ROUTES = [
  '/ops',
  '/ops/evaluations',
  '/ops/conversations',
  '/ops/conversations/:id',
  '/ops/approvals',
  '/ops/shadow',
  '/api/status',
];

function routeOf(drillUrl: string): string {
  const path = (drillUrl.split('?')[0] ?? '').replace(/\/(conv|run)_[A-Z0-9]+$/i, '/:id');
  return path;
}

describe('alert rules', () => {
  it('gives every rule a drill path that points at a route that exists', async () => {
    const results = await evaluateAlerts({ tenantId: serverEnv().KORA_TENANT_ID });
    expect(results).toHaveLength(ALERT_RULES.length);

    for (const r of results) {
      expect(ROUTES, `${r.ruleId} drills to ${r.drillUrl}, which is not a route`).toContain(
        routeOf(r.drillUrl),
      );
    }
  });

  it('says something specific whether or not it is firing', async () => {
    const results = await evaluateAlerts({ tenantId: serverEnv().KORA_TENANT_ID });
    for (const r of results) {
      expect(r.detail.length, `${r.ruleId} said nothing`).toBeGreaterThan(10);
    }
  });

  it('skips the queue and breaker rules rather than firing when no probe is supplied', async () => {
    const results = await evaluateAlerts({ tenantId: serverEnv().KORA_TENANT_ID });
    const queue = results.find((r) => r.ruleId === 'dlq_not_empty');
    const breaker = results.find((r) => r.ruleId === 'breaker_open');

    // Firing on a missing probe would page someone about the monitoring, not the system.
    expect(queue?.firing).toBe(false);
    expect(breaker?.firing).toBe(false);
  });

  it('reads a supplied queue probe', async () => {
    const results = await evaluateAlerts({
      tenantId: serverEnv().KORA_TENANT_ID,
      probes: {
        failedJobCounts: async () => ({ evaluation: 3, ingestion: 0, maintenance: 0 }),
      },
    });
    const queue = results.find((r) => r.ruleId === 'dlq_not_empty');
    expect(queue?.firing).toBe(true);
    expect(queue?.detail).toMatch(/evaluation 3/);
  });

  it('warns rather than pages when a breaker is open past the limit', async () => {
    const results = await evaluateAlerts({
      tenantId: serverEnv().KORA_TENANT_ID,
      probes: {
        openBreakers: async () => [{ key: 'tool:t:create_refund', openForMs: 9 * 60_000 }],
      },
    });
    const breaker = results.find((r) => r.ruleId === 'breaker_open');
    expect(breaker?.firing).toBe(true);
    expect(breaker?.severity).toBe('warn');
    expect(breaker?.detail).toMatch(/9min/);
  });

  it('does not fire a breaker that has only just opened', async () => {
    const results = await evaluateAlerts({
      tenantId: serverEnv().KORA_TENANT_ID,
      probes: { openBreakers: async () => [{ key: 'tool:t:get_order', openForMs: 30_000 }] },
    });
    expect(results.find((r) => r.ruleId === 'breaker_open')?.firing).toBe(false);
  });

  it('puts pages above warnings when it renders', () => {
    const results: AlertResult[] = [
      { ruleId: 'a_warn', severity: 'warn', firing: true, detail: 'a warning', drillUrl: '/ops' },
      { ruleId: 'b_page', severity: 'page', firing: true, detail: 'a page', drillUrl: '/ops' },
    ];
    const text = renderAlerts(results);
    expect(text.indexOf('b_page')).toBeLessThan(text.indexOf('a_warn'));
  });

  it('reports a broken rule as a warning rather than letting it take the run down', async () => {
    const results = await evaluateAlerts({
      tenantId: serverEnv().KORA_TENANT_ID,
      probes: {
        failedJobCounts: async () => {
          throw new Error('redis is gone');
        },
      },
    });
    const queue = results.find((r) => r.ruleId === 'dlq_not_empty');
    expect(queue?.severity).toBe('warn');
    expect(queue?.detail).toMatch(/could not be evaluated/);
  });
});
