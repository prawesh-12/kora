import { logger, serverEnv } from '@kora/core';
import { STRIPE_WRITE_TOOLS } from '@kora/tools';

/**
 * Compares what the agent proposed in shadow mode against what a person actually
 * did.
 *
 * The ground truth is sound here precisely because shadow mode writes nothing: a
 * refund that exists on the subscription after a shadow run was created by someone
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
      subscription_id: string | null;
    }[]
  >`
    SELECT r.id AS run_id,
           r.conversation_id,
           r.started_at,
           w.tool_name AS proposed_action,
           p.facts ->> 'amountMinor' AS proposed_amount_minor,
           w.input ->> 'subscriptionId' AS subscription_id
    FROM agent_runs r
    LEFT JOIN LATERAL (
      SELECT t.tool_name, t.input FROM tool_executions t
      WHERE t.run_id = r.id AND t.tool_name = ANY(${STRIPE_WRITE_TOOLS})
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
      run.subscription_id === null
        ? null
        : await humanResolution(run.subscription_id, run.started_at);

    // Only a refund carries an amount. A cancellation and a plan change have no
    // money on the action itself, so comparing amounts there would report every
    // one of them as a disagreement over nothing.
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

// TODO(plan): the human's real action now lives in Stripe, and only packages/tools
// may read it. Until a tool exposes "what changed on this subscription since T",
// there is no ground truth here, so every shadow run records its proposal with no
// comparison. A null actual is skipped, never counted as agreement.
async function humanResolution(
  _subscriptionId: string,
  _startedAt: Date | string,
): Promise<{ action: string | null; amountMinor: number | null } | null> {
  return null;
}
