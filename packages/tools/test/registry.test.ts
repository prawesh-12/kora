import { ConfigError } from '@kora/core';
import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../src/registry.js';
import { registry } from '../src/tools/index.js';

describe('tool registry', () => {
  it('holds exactly the money-ops tools', () => {
    expect(
      registry
        .list()
        .map((t) => t.name)
        .sort(),
    ).toEqual([
      'cancel_subscription',
      'change_plan',
      'check_policy',
      'create_refund',
      'create_ticket',
      'escalate_to_human',
      'get_customer',
      'get_invoice',
      'get_subscription',
      'preview_change',
      'search_knowledge',
    ]);
  });

  it('throws on a duplicate registration', () => {
    const r = new ToolRegistry();
    const tool = registry.get('get_subscription', 1);
    r.register(tool);
    expect(() => r.register(tool)).toThrow(ConfigError);
  });

  it('names what is registered when a version is unknown', () => {
    expect(() => registry.get('get_subscription', 99)).toThrow(/get_subscription@1/);
  });

  it('round-trips a valid input through every input schema', () => {
    for (const tool of registry.list()) {
      const example = tool.inputExamples?.[0];
      expect(example, `${tool.name} has no input example`).toBeDefined();
      expect(() => tool.inputSchema.parse(example!.input)).not.toThrow();
    }
  });

  it('never retries a write that is not idempotent', () => {
    for (const tool of registry.list()) {
      if (tool.sideEffect === 'read') continue;
      expect(
        tool.idempotent || tool.maxRetries === 0,
        `${tool.name} is a non-idempotent write with maxRetries ${tool.maxRetries}`,
      ).toBe(true);
    }
  });

  it('gives every write tool a verify', () => {
    for (const tool of registry.list()) {
      if (tool.sideEffect === 'read' || tool.name === 'escalate_to_human') continue;
      expect(tool.verify, `${tool.name} has no verify`).toBeTypeOf('function');
    }
  });

  it('classifies reads as read-tool and money writes as idempotent-write', () => {
    const byName = new Map(registry.list().map((t) => [t.name, t]));
    for (const name of [
      'get_subscription',
      'get_customer',
      'get_invoice',
      'preview_change',
      'search_knowledge',
      'check_policy',
    ]) {
      expect(byName.get(name)?.sideEffect, name).toBe('read');
    }
    for (const name of ['create_refund', 'cancel_subscription', 'change_plan']) {
      const tool = byName.get(name);
      expect(tool?.sideEffect, name).toBe('write_high');
      expect(tool?.idempotent, `${name} retries safe only through the claim key`).toBe(true);
    }
  });
});

describe('tool descriptions', () => {
  it('every description starts with a trigger condition', () => {
    for (const tool of registry.list()) {
      expect(tool.description, `${tool.name}`).toMatch(/^Use this when /);
    }
  });

  it('no description describes a mechanism', () => {
    for (const tool of registry.list()) {
      const d = tool.description.toLowerCase();
      for (const word of [' api', 'endpoint', 'calls ']) {
        expect(d.includes(word), `${tool.name} mentions "${word.trim()}"`).toBe(false);
      }
    }
  });
});
