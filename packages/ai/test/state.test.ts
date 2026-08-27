import type { AgentState } from '@kora/core';
import { describe, expect, it } from 'vitest';
import {
  IllegalTransitionError,
  TRANSITIONS,
  assertTransition,
  canTransition,
} from '../src/state.js';

const ALL = Object.keys(TRANSITIONS) as AgentState[];

describe('state machine', () => {
  it('allows every declared transition', () => {
    for (const from of ALL) {
      for (const to of TRANSITIONS[from]) {
        expect(canTransition(from, to)).toBe(true);
      }
    }
  });

  it('throws on every transition that is not declared', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        if (TRANSITIONS[from].includes(to)) continue;
        expect(() => assertTransition(from, to), `${from} -> ${to}`).toThrow(
          IllegalTransitionError,
        );
      }
    }
  });

  it('treats NEEDS_HUMAN as terminal', () => {
    expect(TRANSITIONS.NEEDS_HUMAN).toEqual([]);
    for (const to of ALL) {
      expect(() => assertTransition('NEEDS_HUMAN', to)).toThrow();
    }
  });

  it('never lets a random legal walk reach an undeclared state', () => {
    for (let run = 0; run < 200; run++) {
      let state: AgentState = 'NEW';
      for (let step = 0; step < 12; step++) {
        const next = TRANSITIONS[state];
        if (next.length === 0) break;
        const chosen = next[Math.floor(Math.random() * next.length)]!;
        assertTransition(state, chosen);
        state = chosen;
        expect(ALL).toContain(state);
      }
    }
  });

  it('names the allowed moves in the error', () => {
    try {
      assertTransition('NEW', 'RESOLVED');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as IllegalTransitionError).context.allowed).toEqual(['IDENTIFYING_INTENT']);
    }
  });
});
