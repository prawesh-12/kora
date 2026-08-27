import type { Intent } from '@kora/core';
import { describe, expect, it } from 'vitest';
import { gateToolsByState } from '../src/agent.js';
import { type ResolvedAgentConfig, loadAgentConfig } from '../src/config.js';
import { SYSTEM_POLICY } from '../src/prompts/system.js';

const file = loadAgentConfig();
const config: ResolvedAgentConfig = {
  ...file,
  agentVersionId: null,
  systemPolicy: SYSTEM_POLICY,
  source: 'file',
};

const ORDER = {
  id: '9832',
  customerId: 'cus_014',
  status: 'delivered',
  items: [{ sku: 'SKU-CM-01', category: 'appliance', quantity: 1, unitAmountMinor: 349900 }],
  totalAmountMinor: 349900,
  currency: 'INR',
  deliveredAt: new Date('2026-08-23').toISOString(),
  replacementIds: [] as string[],
};

const WRITE_TOOLS = ['create_replacement', 'create_refund', 'cancel_order'];

function gate(intent: Intent, hasOrder: boolean) {
  return gateToolsByState(config, intent, { gathered: hasOrder ? { order: ORDER } : {} });
}

describe('tool gating', () => {
  it('never exposes a write tool before an order has been fetched', () => {
    for (const intent of ['DAMAGED_ORDER', 'REFUND_REQUEST', 'CANCEL_ORDER'] as Intent[]) {
      const active = gate(intent, false);
      for (const w of WRITE_TOOLS) expect(active, `${intent}`).not.toContain(w);
      expect(active).toContain('get_order');
      expect(active).toContain('escalate_to_human');
    }
  });

  it('never exposes any write tool for ORDER_STATUS, even with the order in hand', () => {
    const active = gate('ORDER_STATUS', true);
    for (const w of WRITE_TOOLS) expect(active).not.toContain(w);
  });

  it('exposes only the write tool that matches the intent', () => {
    const cases: Array<[Intent, string]> = [
      ['DAMAGED_ORDER', 'create_replacement'],
      ['REFUND_REQUEST', 'create_refund'],
      ['CANCEL_ORDER', 'cancel_order'],
    ];
    for (const [intent, expected] of cases) {
      const active = gate(intent, true);
      const registered = new Set(config.allowedTools.map((t) => t.name));
      if (!registered.has(expected)) continue;
      expect(active, `${intent}`).toContain(expected);
      for (const other of WRITE_TOOLS.filter((w) => w !== expected)) {
        expect(active, `${intent} should not reach ${other}`).not.toContain(other);
      }
    }
  });

  it('exposes nothing but reads and escalation for a handover intent', () => {
    for (const intent of ['HUMAN_REQUEST', 'OUT_OF_SCOPE'] as Intent[]) {
      const active = gate(intent, true);
      for (const w of WRITE_TOOLS) expect(active).not.toContain(w);
    }
  });

  it('only ever offers tools the agent config actually allows', () => {
    const registered = new Set(config.allowedTools.map((t) => t.name));
    for (const intent of ['ORDER_STATUS', 'DAMAGED_ORDER', 'REFUND_REQUEST'] as Intent[]) {
      for (const name of gate(intent, true)) expect(registered).toContain(name);
    }
  });
});
