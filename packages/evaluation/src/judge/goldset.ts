import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleTrace, desc, agentRuns, db, eq } from '@kora/db';
import type { AssembledTrace } from '../deps.js';
import type { Verdict } from '../types.js';
import { applicableCriteria, loadRubric } from './rubric.js';

/**
 * Labels one trace the way a person reading it would: from what the trace
 * actually contains, criterion by criterion.
 *
 * This is the honest limit of an offline gold set. A real gold set is labelled by
 * a human, and the whole point of calibration is to measure the judge against
 * that human. Here the labels come from the same evidence the judge reads, so
 * agreement measures whether the judge reads the trace consistently, not whether
 * it agrees with a person. Replace these labels by hand before trusting the
 * number for anything.
 */
function labelTrace(trace: AssembledTrace): Record<string, Verdict> {
  const rubric = loadRubric();
  const labels: Record<string, Verdict> = {};

  const agentMessages = trace.conversation.messages.filter((m) => m.role === 'agent');
  const finalMessage = agentMessages.at(-1)?.content ?? '';
  const toolText = trace.toolExecutions.map((e) => JSON.stringify(e.output ?? null)).join('\n');
  const escalated = trace.escalation !== null;
  const resolved = trace.run.outcome === 'resolved_automatically';

  for (const c of applicableCriteria(rubric, trace)) {
    switch (c.id) {
      case 'explanation_matches_policy': {
        const denied = trace.policyChecks.find((p) => p.decision === 'deny');
        if (!denied) {
          labels[c.id] = 'MET';
          break;
        }
        const words = denied.reason
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length > 4);
        const overlap = words.filter((w) => finalMessage.toLowerCase().includes(w)).length;
        labels[c.id] = overlap >= Math.min(2, words.length) ? 'MET' : 'UNMET';
        break;
      }
      case 'no_unsupported_claims': {
        const ids = finalMessage.match(/\b(?:re|sub|in|ch|price)_[A-Za-z0-9]+/g) ?? [];
        labels[c.id] = ids.every((id) => toolText.includes(id)) ? 'MET' : 'UNMET';
        break;
      }
      case 'intent_understood':
        labels[c.id] = trace.run.intent ? 'MET' : 'CANNOT_ASSESS';
        break;
      case 'escalation_reason_valid':
        labels[c.id] = escalated ? 'MET' : 'CANNOT_ASSESS';
        break;
      case 'tone_appropriate':
        labels[c.id] = 'MET';
        break;
      case 'no_dead_end':
        labels[c.id] = resolved
          ? 'CANNOT_ASSESS'
          : /colleague|shortly|get back|follow up|confirm|someone will/i.test(finalMessage)
            ? 'MET'
            : 'UNMET';
        break;
    }
  }

  return labels;
}

export async function buildGoldSet(args: {
  tenantId: string;
  outDir: string;
  limit?: number;
}): Promise<number> {
  const limit = args.limit ?? 30;
  mkdirSync(args.outDir, { recursive: true });

  const runs = await db()
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(eq(agentRuns.tenantId, args.tenantId))
    .orderBy(desc(agentRuns.startedAt))
    .limit(limit);

  let written = 0;
  for (const [i, run] of runs.entries()) {
    const trace = await assembleTrace(args.tenantId, run.id);
    if (trace.run.finishedAt === null) continue;

    const item = {
      id: run.id,
      note: `${trace.run.intent ?? 'unknown'} / ${trace.run.finalState ?? 'unknown'}`,
      labels: labelTrace(trace),
      trace,
    };
    writeFileSync(
      join(args.outDir, `${String(i).padStart(3, '0')}-${run.id}.json`),
      JSON.stringify(item, null, 2),
    );
    written++;
  }

  return written;
}
