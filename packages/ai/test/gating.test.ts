import { HANDOVER_INTENTS, READ_ONLY_INTENTS, type Intent } from '@kora/core';
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

const SUBSCRIPTION = {
  id: 'sub_7H21',
  status: 'active' as const,
  customerId: 'cus_014',
  items: [
    {
      subscriptionItemId: 'si_1S',
      priceId: 'price_1S',
      productId: 'prod_9P',
      unitAmount: { amountMinor: 349900, currency: 'INR' },
      quantity: 1,
    },
  ],
  currentPeriodEnd: 1770000000,
  cancelAtPeriodEnd: false,
  canceledAt: null,
  cancelAt: null,
  latestInvoiceId: 'in_9K81',
  collectionMethod: 'charge_automatically',
};

const WRITE_TOOLS = ['create_refund', 'cancel_subscription', 'change_plan'];

function gate(intent: Intent, hasSubscription: boolean) {
  return gateToolsByState(config, intent, {
    gathered: hasSubscription ? { subscription: SUBSCRIPTION } : {},
  });
}

describe('tool gating', () => {
  it('never exposes a write tool before a subscription has been fetched', () => {
    for (const intent of ['CANCEL_SUBSCRIPTION', 'REFUND_REQUEST', 'CHANGE_PLAN'] as Intent[]) {
      const active = gate(intent, false);
      for (const w of WRITE_TOOLS) expect(active, `${intent}`).not.toContain(w);
      expect(active).toContain('get_subscription');
      expect(active).toContain('escalate_to_human');
    }
  });

  it('never exposes any write tool for BILLING_QUESTION, even with the subscription in hand', () => {
    const active = gate('BILLING_QUESTION', true);
    for (const w of WRITE_TOOLS) expect(active).not.toContain(w);
  });

  it('exposes only the write tool that matches the intent', () => {
    const cases: Array<[Intent, string]> = [
      ['CANCEL_SUBSCRIPTION', 'cancel_subscription'],
      ['REFUND_REQUEST', 'create_refund'],
      ['CHANGE_PLAN', 'change_plan'],
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
    for (const intent of [
      'BILLING_QUESTION',
      'CANCEL_SUBSCRIPTION',
      'REFUND_REQUEST',
    ] as Intent[]) {
      for (const name of gate(intent, true)) expect(registered).toContain(name);
    }
  });

  it('gives every read-only or handover intent no write tool in view', () => {
    const readOnly = new Set([
      'get_subscription',
      'get_customer',
      'get_invoice',
      'preview_change',
      'search_knowledge',
      'check_policy',
      'escalate_to_human',
    ]);
    for (const intent of [...READ_ONLY_INTENTS, ...HANDOVER_INTENTS]) {
      const active = gate(intent, true);
      expect(active.length).toBeGreaterThan(0);
      for (const name of active) expect(readOnly, `${intent} sees ${name}`).toContain(name);
    }
  });
});
