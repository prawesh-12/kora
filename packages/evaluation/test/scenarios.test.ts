import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scenarioSchema } from '../../../scenarios/schema.js';

const SCENARIO_DIR = join(import.meta.dirname, '../../../scenarios');
const SEEDED_ORDERS = new Set(['9832', '9833', '9834', '9835', '9836']);
const KNOWN_TOOLS = new Set([
  'get_order',
  'get_customer',
  'search_knowledge',
  'check_policy',
  'create_replacement',
  'escalate_to_human',
]);

const files = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.json'));
const scenarios = files.map((f) => ({
  file: f,
  raw: JSON.parse(readFileSync(join(SCENARIO_DIR, f), 'utf8')) as unknown,
}));

describe('scenario files', () => {
  it('covers both happy paths and ten negatives', () => {
    expect(files).toHaveLength(12);
  });

  for (const { file, raw } of scenarios) {
    it(`${file} validates against the schema`, () => {
      const parsed = scenarioSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'),
        );
      }
    });
  }

  it('has unique ids and names', () => {
    const parsed = scenarios.map((s) => scenarioSchema.parse(s.raw));
    expect(new Set(parsed.map((s) => s.id)).size).toBe(parsed.length);
    expect(new Set(parsed.map((s) => s.name)).size).toBe(parsed.length);
  });

  it('only references seeded orders, or 9999 which must not exist', () => {
    for (const { file, raw } of scenarios) {
      const s = scenarioSchema.parse(raw);
      if (!s.seed.orderId) continue;
      expect(SEEDED_ORDERS.has(s.seed.orderId), `${file} references ${s.seed.orderId}`).toBe(true);
    }
  });

  it('only names tools that exist', () => {
    for (const { file, raw } of scenarios) {
      const s = scenarioSchema.parse(raw);
      for (const name of [...s.expect.tools, ...s.expect.forbiddenTools]) {
        expect(KNOWN_TOOLS.has(name), `${file} names unknown tool ${name}`).toBe(true);
      }
      for (const f of s.faults) {
        expect(KNOWN_TOOLS.has(f.onTool), `${file} arms a fault on unknown tool ${f.onTool}`).toBe(
          true,
        );
      }
    }
  });

  it('rejects a corrupted scenario', () => {
    expect(scenarioSchema.safeParse({ id: 'H1' }).success).toBe(false);
    expect(
      scenarioSchema.safeParse({ ...(scenarios[0]!.raw as object), unexpectedKey: 1 }).success,
    ).toBe(false);
  });
});
