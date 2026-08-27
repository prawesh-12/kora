import { db, eq, sql, tenants } from '@kora/db';

export interface Caps {
  maxActionsPerDay: number | null;
  maxValueMinorPerAction: number | null;
  maxValueMinorPerDay: number | null;
}

export async function loadCaps(tenantId: string): Promise<Caps> {
  const [row] = await db()
    .select({
      maxActionsPerDay: tenants.maxActionsPerDay,
      maxValueMinorPerAction: tenants.maxValueMinorPerAction,
      maxValueMinorPerDay: tenants.maxValueMinorPerDay,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId));

  return row ?? { maxActionsPerDay: null, maxValueMinorPerAction: null, maxValueMinorPerDay: null };
}

/**
 * What the tenant has already spent today, counted from what actually landed.
 * A denied or failed attempt has cost nothing, so it does not count against a cap.
 *
 * The amount comes from the `policy_checks` row for the same action, because that
 * is where the value was priced from records. Reading it back off the tool input
 * would let the model set its own cap.
 */
export async function spentToday(
  tenantId: string,
): Promise<{ actions: number; valueMinor: number }> {
  const rows = await sql()<{ actions: string; value_minor: string }[]>`
    SELECT count(*) AS actions,
           coalesce(sum((p.facts ->> 'amountMinor')::bigint), 0) AS value_minor
    FROM tool_executions t
    LEFT JOIN policy_checks p
      ON p.run_id = t.run_id AND p.action = t.tool_name AND p.advisory = false
    WHERE t.tenant_id = ${tenantId}
      AND t.started_at >= date_trunc('day', now())
      AND t.status IN ('ok', 'replayed')
      AND t.tool_name IN ('create_replacement', 'create_refund', 'cancel_order')`;

  return {
    actions: Number(rows[0]?.actions ?? 0),
    valueMinor: Number(rows[0]?.value_minor ?? 0),
  };
}

/**
 * The reason this action goes to a person, or `null` to let it run.
 * Exceeding a cap never fails the action: `limited` mode is a rung on the way to
 * autonomy, and a hard failure there just teaches operators to skip the rung.
 */
export function capExceeded(
  caps: Caps,
  spent: { actions: number; valueMinor: number },
  amountMinor: number | null,
): string | null {
  if (caps.maxActionsPerDay !== null && spent.actions >= caps.maxActionsPerDay) {
    return `the daily limit of ${caps.maxActionsPerDay} actions is already used`;
  }
  if (
    amountMinor !== null &&
    caps.maxValueMinorPerAction !== null &&
    amountMinor > caps.maxValueMinorPerAction
  ) {
    return `this action is worth more than the per-action limit of ${caps.maxValueMinorPerAction}`;
  }
  if (
    amountMinor !== null &&
    caps.maxValueMinorPerDay !== null &&
    spent.valueMinor + amountMinor > caps.maxValueMinorPerDay
  ) {
    return `this action would take today past the daily value limit of ${caps.maxValueMinorPerDay}`;
  }
  return null;
}
