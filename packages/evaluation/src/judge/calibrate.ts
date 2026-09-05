import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ValidationError } from '@kora/core';
import { z } from 'zod';
import type { AssembledTrace } from '../deps.js';
import type { Verdict } from '../types.js';
import { type JudgeCaller, judgeRun } from './judge.js';
import { type Rubric, loadRubric } from './rubric.js';

const MIN_GOLD_SET = 20;
const AGREEMENT_GATE = 0.8;

/**
 * Kappa swings wildly with one disagreement on a small sample, so below this many
 * labels it is reported but not gated on.
 */
const MIN_KAPPA_SAMPLE = 100;
const KAPPA_GATE = 0.6;

export const goldTraceSchema = z.object({
  id: z.string().min(1),
  note: z.string().default(''),
  /** The verdict a person gave, per criterion. */
  labels: z.record(z.string(), z.enum(['MET', 'UNMET', 'CANNOT_ASSESS'])),
  trace: z.unknown(),
});

export type GoldTrace = z.infer<typeof goldTraceSchema>;

export interface CriterionAgreement {
  criterionId: string;
  agreement: number;
  kappa: number;
  n: number;
}

export function cohensKappa(pairs: Array<[Verdict, Verdict]>): number {
  if (pairs.length === 0) return Number.NaN;

  const labels: Verdict[] = ['MET', 'UNMET', 'CANNOT_ASSESS'];
  const n = pairs.length;
  const observed = pairs.filter(([a, b]) => a === b).length / n;

  let expected = 0;
  for (const label of labels) {
    const pa = pairs.filter(([a]) => a === label).length / n;
    const pb = pairs.filter(([, b]) => b === label).length / n;
    expected += pa * pb;
  }

  if (expected === 1) return observed === 1 ? 1 : 0;
  return (observed - expected) / (1 - expected);
}

export function loadGoldSet(dir: string): GoldTrace[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  return files.map((f) => goldTraceSchema.parse(JSON.parse(readFileSync(join(dir, f), 'utf8'))));
}

export async function calibrate(args: {
  goldSetPath: string;
  call: JudgeCaller;
  rubric?: Rubric;
}): Promise<CriterionAgreement[]> {
  const gold = loadGoldSet(args.goldSetPath);
  if (gold.length < MIN_GOLD_SET) {
    throw new ValidationError(
      `the gold set has ${gold.length} traces. Calibration needs at least ${MIN_GOLD_SET} to report anything meaningful.`,
      { code: 'GOLD_SET_TOO_SMALL', context: { found: gold.length, needed: MIN_GOLD_SET } },
    );
  }

  const rubric = args.rubric ?? loadRubric();
  const pairsByCriterion = new Map<string, Array<[Verdict, Verdict]>>();

  for (const item of gold) {
    const outcome = await judgeRun({
      trace: item.trace as AssembledTrace,
      rubric,
      call: args.call,
    });
    for (const check of outcome.checks) {
      const criterionId = check.id.replace(/^judge:/, '');
      const label = item.labels[criterionId];
      if (!label) continue;
      const pairs = pairsByCriterion.get(criterionId) ?? [];
      pairs.push([label, check.verdict]);
      pairsByCriterion.set(criterionId, pairs);
    }
  }

  return [...pairsByCriterion]
    .map(([criterionId, pairs]) => ({
      criterionId,
      agreement: pairs.filter(([a, b]) => a === b).length / pairs.length,
      kappa: cohensKappa(pairs),
      n: pairs.length,
    }))
    .sort((a, b) => a.criterionId.localeCompare(b.criterionId));
}

export function calibrationPasses(results: CriterionAgreement[]): boolean {
  return (
    results.length > 0 &&
    results.every((r) => r.agreement >= AGREEMENT_GATE) &&
    criteriaBelowKappa(results).length === 0
  );
}

/** Criteria below the gate are disabled rather than shipped with a warning. */
export function criteriaBelowKappa(results: CriterionAgreement[]): CriterionAgreement[] {
  return results.filter(
    (r) => r.n >= MIN_KAPPA_SAMPLE && !Number.isNaN(r.kappa) && r.kappa < KAPPA_GATE,
  );
}

export function kappaIsGated(results: CriterionAgreement[]): boolean {
  return results.some((r) => r.n >= MIN_KAPPA_SAMPLE);
}

export const KAPPA_SETTINGS = { gate: KAPPA_GATE, minSample: MIN_KAPPA_SAMPLE };

export function renderCalibration(results: CriterionAgreement[]): string {
  const failing = criteriaBelowKappa(results);
  const rows = results.map((r) => [
    r.criterionId,
    `${(r.agreement * 100).toFixed(0)}%`,
    Number.isNaN(r.kappa) ? '-' : r.kappa.toFixed(2),
    String(r.n),
  ]);
  const header = ['criterion', 'agreement', 'kappa', 'n'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd();

  return [
    line(header),
    line(widths.map((w) => '-'.repeat(w))),
    ...rows.map(line),
    '',
    `gate: agreement at or above ${AGREEMENT_GATE * 100}% per criterion.`,
    kappaIsGated(results)
      ? `kappa at or above ${KAPPA_GATE} per criterion, on at least ${MIN_KAPPA_SAMPLE} labels.`
      : `kappa is reported but not gated: no criterion has the ${MIN_KAPPA_SAMPLE} labels that would make it mean anything.`,
    ...(failing.length === 0
      ? []
      : [
          '',
          'Disable these criteria and publish the rubric as a new version:',
          ...failing.map(
            (r) => `  ${r.criterionId}  kappa ${r.kappa.toFixed(2)} over ${r.n} labels`,
          ),
        ]),
  ].join('\n');
}

export { AGREEMENT_GATE, MIN_GOLD_SET };
