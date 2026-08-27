import { ConfigError } from '@kora/core';
import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../src/registry.js';
import { registry } from '../src/tools/index.js';

describe('tool registry', () => {
  it('holds exactly the nine tools', () => {
    expect(
      registry
        .list()
        .map((t) => t.name)
        .sort(),
    ).toEqual([
      'cancel_order',
      'check_policy',
      'create_refund',
      'create_replacement',
      'create_ticket',
      'escalate_to_human',
      'get_customer',
      'get_order',
      'search_knowledge',
    ]);
  });

  it('throws on a duplicate registration', () => {
    const r = new ToolRegistry();
    const tool = registry.get('get_order', 1);
    r.register(tool);
    expect(() => r.register(tool)).toThrow(ConfigError);
  });

  it('names what is registered when a version is unknown', () => {
    expect(() => registry.get('get_order', 99)).toThrow(/get_order@1/);
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
