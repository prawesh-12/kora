const STRIPE_ID = /\b(?:re|sub|in|price|prod|pi|ch|cus|si)_[A-Za-z0-9]+\b/g;
const PLAN_NAME = /\b([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)*\s+(?:plan|tier))\b/g;
const MONEY = /(?:INR|Rs\.?|₹|\$|USD)\s?([\d,]+(?:\.\d{1,2})?)/gi;

const GENERIC_LEADERS = new Set([
  'the',
  'your',
  'this',
  'that',
  'a',
  'an',
  'our',
  'their',
  'my',
  'its',
]);

export interface GroundingResult {
  grounded: boolean;
  unsupported: string[];
}

function tokensOf(value: unknown): Set<string> {
  return new Set(
    JSON.stringify(value ?? null)
      .split(/[^A-Za-z0-9_]+/)
      .filter((p) => p.length > 0),
  );
}

function planNameOf(match: string): string | null {
  const leader = match.split(/\s+/)[0]?.toLowerCase() ?? '';
  if (GENERIC_LEADERS.has(leader)) return null;
  return match;
}

export function checkGrounding(
  message: string,
  toolOutputs: unknown[],
  customerText = '',
): GroundingResult {
  const toolTokens = new Set<string>();
  for (const output of toolOutputs) {
    for (const token of tokensOf(output)) toolTokens.add(token);
  }
  const customerTokens = tokensOf(customerText);
  const toolText = toolOutputs.map((o) => JSON.stringify(o ?? null).toLowerCase()).join('\n');
  const customerLower = customerText.toLowerCase();
  const unsupported: string[] = [];

  for (const id of message.match(STRIPE_ID) ?? []) {
    if (!toolTokens.has(id) && !customerTokens.has(id)) unsupported.push(id);
  }

  for (const match of message.matchAll(PLAN_NAME)) {
    const name = planNameOf(match[1] ?? '');
    if (!name) continue;
    const needle = name.toLowerCase();
    if (!toolText.includes(needle) && !customerLower.includes(needle)) {
      unsupported.push(name);
    }
  }

  for (const match of message.matchAll(MONEY)) {
    const raw = (match[1] ?? '').replace(/,/g, '');
    if (!raw) continue;
    const minor = String(Math.round(Number(raw) * 100));
    if (!toolTokens.has(minor)) unsupported.push(match[0]);
  }

  return { grounded: unsupported.length === 0, unsupported: [...new Set(unsupported)] };
}

export const UNGROUNDED_FALLBACK =
  'I want to be accurate here and I am not able to confirm the details, so I have passed this to a colleague. Someone will come back to you shortly with the right answer.';
