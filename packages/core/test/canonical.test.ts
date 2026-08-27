import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/canonical.js';
import { ValidationError } from '../src/errors.js';

describe('canonicalJson', () => {
  it('is stable across key order', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('is stable for nested objects', () => {
    const a = { outer: { z: 1, a: { y: 2, b: 3 } }, first: true };
    const b = { first: true, outer: { a: { b: 3, y: 2 }, z: 1 } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it('drops undefined values consistently', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('emits no whitespace', () => {
    expect(canonicalJson({ a: 1, b: [1, 2] })).toBe('{"a":1,"b":[1,2]}');
  });

  it('throws on a circular reference instead of hanging', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => canonicalJson(obj)).toThrow(ValidationError);
  });

  it('allows the same object twice in a tree', () => {
    const shared = { x: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });
});
