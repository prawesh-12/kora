import { logger, serverEnv } from '@kora/core';

const WRITE_TOOLS = ['create_replacement', 'create_refund', 'cancel_order'];

/**
 * Compares what the agent proposed in shadow mode against what a person actually
 * did.
 *
 * The ground truth is sound here precisely because shadow mode writes nothing: a
 * replacement that exists on the order after a shadow run was created by someone
 * else. Runs with no human record are skipped, never counted as agreement.
 */
export async function shadowCompareJob(): Promise<void> {
  const { sql, recordShadowComparison } = await import('@kora/db');
  const tenantId = serverEnv().KORA_TENANT_ID;

  const runs = await sql()<
    {
      run_id: string;
      conversation_id: string;
      started_at: Date | string;
      proposed_action: string | null;
      proposed_amount_minor: string | null;
      order_id: string | null;
    }[]
  >`
    SELECT r.id AS run_id,
           r.conversation_id,
           r.started_at,
           w.tool_name AS proposed_action,
           p.facts ->> 'amountMinor' AS proposed_amount_minor,
           w.input ->> 'orderId' AS order_id
    FROM agent_runs r
    LEFT JOIN LATERAL (
      SELECT t.tool_name, t.input FROM tool_executions t
      WHERE t.run_id = r.id AND t.tool_name = ANY(${WRITE_TOOLS})
      ORDER BY t.started_at DESC LIMIT 1
    ) w ON true
    LEFT JOIN policy_checks p
      ON p.run_id = r.id AND p.action = w.tool_name AND p.advisory = false
    WHERE r.tenant_id = ${tenantId}
      AND r.deployment_mode = 'shadow'
      AND r.finished_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM shadow_comparisons s WHERE s.run_id = r.id)`;

  for (const run of runs) {
    const actual =
      run.order_id === null ? null : await humanResolution(run.order_id, run.started_at);

    // Only a refund carries an amount. A replacement and a cancellation have no
    // money on them in Acme, so comparing amounts there would report every one of
    // them as a disagreement over nothing.
    const carriesAmount = run.proposed_action === 'create_refund';

    await recordShadowComparison(
      {
        tenantId,
        conversationId: run.conversation_id,
        runId: run.run_id,
        proposedAction: run.proposed_action,
        proposedAmountMinor:
          carriesAmount && run.proposed_amount_minor !== null
            ? Number(run.proposed_amount_minor)
            : null,
      },
      actual,
    );
  }

  if (runs.length > 0) logger().info({ compared: runs.length }, 'shadow comparisons recorded');
}

async function humanResolution(
  orderId: string,
  startedAt: Date | string,
): Promise<{ action: string | null; amountMinor: number | null } | null> {
  const { sql } = await import('@kora/db');
  const since = new Date(startedAt).toISOString();
  const [row] = await sql()<{ action: string; amount_minor: string | null }[]>`
    SELECT 'create_replacement' AS action, NULL::text AS amount_minor
    FROM acme_replacements WHERE order_id = ${orderId} AND created_at >= ${since}::timestamptz
    UNION ALL
    SELECT 'create_refund', amount_minor::text
    FROM acme_refunds WHERE order_id = ${orderId} AND created_at >= ${since}::timestamptz
    UNION ALL
    SELECT 'cancel_order', NULL::text
    FROM acme_cancellations WHERE order_id = ${orderId} AND created_at >= ${since}::timestamptz
    LIMIT 1`;

  if (!row) return null;
  return {
    action: row.action,
    amountMinor: row.amount_minor === null ? null : Number(row.amount_minor),
  };
}
