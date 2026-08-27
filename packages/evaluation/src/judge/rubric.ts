import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError } from '@kora/core';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { AssembledTrace } from '../deps.js';

export type Applicability =
  | 'always'
  | 'policy_check_present'
  | 'escalated'
  | 'not_resolved'
  | 'write_attempted';

const criterion = z
  .object({
    id: z.string().min(1),
    applies_when: z.enum([
      'always',
      'policy_check_present',
      'escalated',
      'not_resolved',
      'write_attempted',
    ]),
    weight: z.number().int().positive(),
    requirement: z.string().min(1),
  })
  .strict();

export const rubricSchema = z
  .object({
    version: z.string().min(1),
    description: z.string().default(''),
    criteria: z.array(criterion).min(1),
  })
  .strict();

export type Rubric = z.infer<typeof rubricSchema>;
export type Criterion = z.infer<typeof criterion>;

const RUBRIC_DIR = join(import.meta.dirname, '../../../../config/rubrics');

export function loadRubric(version = 'support-v1'): Rubric {
  const parsed = rubricSchema.safeParse(
    parseYaml(readFileSync(join(RUBRIC_DIR, `${version}.yaml`), 'utf8')),
  );
  if (!parsed.success) {
    throw new ConfigError(
      `invalid rubric ${version}:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
      { code: 'RUBRIC_INVALID' },
    );
  }
  const seen = new Set<string>();
  for (const c of parsed.data.criteria) {
    if (seen.has(c.id)) {
      throw new ConfigError(`rubric ${version} has a duplicate criterion id "${c.id}"`, {
        code: 'RUBRIC_DUPLICATE_CRITERION',
      });
    }
    seen.add(c.id);
  }
  return parsed.data;
}

/**
 * Works out which criteria apply from the trace, in code, before the judge sees
 * anything. A judge asked to score `escalation_reason_valid` on a run that never
 * escalated will invent an answer rather than say it cannot.
 */
export function applicableCriteria(rubric: Rubric, trace: AssembledTrace): Criterion[] {
  const hasPolicyCheck = trace.policyChecks.length > 0;
  const escalated = trace.escalation !== null;
  const resolved = trace.run.outcome === 'resolved_automatically';
  const writeAttempted = trace.toolExecutions.some(
    (e) =>
      e.toolName !== 'get_order' &&
      e.toolName !== 'get_customer' &&
      e.toolName !== 'search_knowledge' &&
      e.toolName !== 'check_policy',
  );

  const applies = (when: Applicability): boolean => {
    switch (when) {
      case 'always':
        return true;
      case 'policy_check_present':
        return hasPolicyCheck;
      case 'escalated':
        return escalated;
      case 'not_resolved':
        return !resolved;
      case 'write_attempted':
        return writeAttempted;
    }
  };

  return rubric.criteria.filter((c) => applies(c.applies_when));
}
