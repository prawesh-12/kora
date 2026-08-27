import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '@kora/core';

interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PRICING_PATH = join(import.meta.dirname, '../../../config/pricing.json');

let table: Record<string, ModelPrice> | null = null;
const warned = new Set<string>();

function prices(): Record<string, ModelPrice> {
  if (!table) {
    const raw = JSON.parse(readFileSync(PRICING_PATH, 'utf8')) as {
      models: Record<string, ModelPrice>;
    };
    table = raw.models;
  }
  return table;
}

export function costUsdMicros(
  model: string,
  usage: { inputTokens: number; outputTokens: number },
): number | null {
  const price = prices()[model];
  if (!price) {
    if (!warned.has(model)) {
      warned.add(model);
      logger().warn({ model }, 'no pricing entry for model, cost will be recorded as null');
    }
    return null;
  }
  const micros =
    (usage.inputTokens * price.inputPerMillion + usage.outputTokens * price.outputPerMillion) /
    1_000_000;
  return Math.round(micros);
}
