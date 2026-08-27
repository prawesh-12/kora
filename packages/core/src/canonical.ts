import { ValidationError } from './errors.js';

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'number' && !Number.isFinite(value) ? null : value;
  }
  if (seen.has(value)) {
    throw new ValidationError('cannot canonicalise a circular structure', {
      code: 'CIRCULAR_REFERENCE',
    });
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((v) => walk(v, seen));
    if (value instanceof Date) return value.toISOString();
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = walk(v, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(walk(value, new WeakSet()));
}
