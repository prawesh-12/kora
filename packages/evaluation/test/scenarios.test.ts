import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scenarioSchema } from '../src/scenarios/schema.js';
import { FIXTURE_KEYS } from '../src/scenarios/stripe-stub.js';

const SCENARIO_DIR = join(import.meta.dirname, '../../../scenarios');
const FIXTURE_CUSTOMERS = new Set(FIXTURE_KEYS.customers);
const FIXTURE_SUBSCRIPTIONS = new Set(FIXTURE_KEYS.subscriptions);
const FIXTURE_CHARGES = new Set(FIXTURE_KEYS.charges);
const FIXTURE_INVOICES = new Set(FIXTURE_KEYS.invoices);
const KNOWN_TOOLS = new Set([
  'get_subscription',
  'get_customer',
  'get_invoice',
  'preview_change',
  'search_knowledge',
  'check_policy',
  'create_refund',
  'cancel_subscription',
  'change_plan',
  'create_ticket',
  'escalate_to_human',
]);

const files = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.json'));
const scenarios = files.map((f) => ({
  file: f,
  raw: JSON.parse(readFileSync(join(SCENARIO_DIR, f), 'utf8')) as unknown,
}));

describe('scenario files', () => {
  for (const { file, raw } of scenarios) {
    it(`${file} validates against the schema`, () => {
      const parsed = scenarioSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues
            .map(
              (i: { path: PropertyKey[]; message: string }) => `${i.path.join('.')}: ${i.message}`,
            )
            .join('\n'),
        );
      }
    });
  }

  it('has unique ids and names', () => {
    const parsed = scenarios.map((s) => scenarioSchema.parse(s.raw));
    expect(new Set(parsed.map((s) => s.id)).size).toBe(parsed.length);
    expect(new Set(parsed.map((s) => s.name)).size).toBe(parsed.length);
  });

  it('only references known Stripe fixture keys', () => {
    for (const { file, raw } of scenarios) {
      const s = scenarioSchema.parse(raw);
      if (s.seed.customerKey !== undefined) {
        expect(
          FIXTURE_CUSTOMERS.has(s.seed.customerKey),
          `${file} references ${s.seed.customerKey}`,
        ).toBe(true);
      }
      if (s.seed.subscriptionKey !== undefined) {
        expect(
          FIXTURE_SUBSCRIPTIONS.has(s.seed.subscriptionKey),
          `${file} references ${s.seed.subscriptionKey}`,
        ).toBe(true);
      }
      if (s.seed.chargeKey !== undefined) {
        expect(
          FIXTURE_CHARGES.has(s.seed.chargeKey),
          `${file} references ${s.seed.chargeKey}`,
        ).toBe(true);
      }
      if (s.seed.invoiceKey !== undefined) {
        expect(
          FIXTURE_INVOICES.has(s.seed.invoiceKey),
          `${file} references ${s.seed.invoiceKey}`,
        ).toBe(true);
      }
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
    expect(scenarioSchema.safeParse({ id: 'S1' }).success).toBe(false);
    expect(
      scenarioSchema.safeParse({ ...(scenarios[0]!.raw as object), unexpectedKey: 1 }).success,
    ).toBe(false);
  });
});
