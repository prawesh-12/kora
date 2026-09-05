import { logger, serverEnv } from '@kora/core';
import type { Queue } from 'bullmq';
import type { EventJob, QueueName } from '../queues.js';

/**
 * Delivery is a log line on purpose: there is no pager here, and a fake one would
 * make alerting look done. `KORA_ALERT_WEBHOOK_URL` is the real path when it is set.
 */
export async function evaluateAlertsJob(queues: Record<QueueName, Queue<EventJob>>): Promise<void> {
  const { evaluateAlerts } = await import('@kora/evaluation');
  const env = serverEnv();
  const log = logger();

  const results = await evaluateAlerts({
    tenantId: env.KORA_TENANT_ID,
    probes: {
      async failedJobCounts() {
        const counts: Record<string, number> = {};
        for (const [name, queue] of Object.entries(queues)) {
          counts[name] = (await queue.getJobCounts('failed')).failed ?? 0;
        }
        return counts;
      },
      async openBreakers() {
        const { breaker } = await import('@kora/tools');
        return breaker().listOpen();
      },
    },
  });

  for (const r of results.filter((r) => r.firing)) {
    log[r.severity === 'page' ? 'error' : 'warn'](
      { alert: r.ruleId, severity: r.severity, drillUrl: r.drillUrl },
      r.detail,
    );
  }

  const url = env.KORA_ALERT_WEBHOOK_URL;
  const firing = results.filter((r) => r.firing);
  if (url && firing.length > 0) {
    // A failed post throws, and the queue retries the job. An alert that was
    // never delivered must not be recorded as delivered.
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: env.KORA_TENANT_ID, alerts: firing }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`alert delivery failed with ${res.status}`);
  }
}
