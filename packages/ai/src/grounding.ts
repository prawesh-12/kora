const REPLACEMENT_ID = /\bREP-\d+\b/g;
const ORDER_ID = /\b\d{4,}\b/g;
const MONEY = /(?:INR|Rs\.?|₹)\s?([\d,]+(?:\.\d{1,2})?)/gi;

export interface GroundingResult {
  grounded: boolean;
  unsupported: string[];
}

function normaliseAmount(raw: string): string {
  return raw.replace(/[,\s]/g, '').replace(/\.00$/, '');
}

/**
 * Extracts every replacement id, order id and money amount from the draft and
 * asserts each one appears somewhere in a tool result from this run.
 *
 * A regex sweep will not catch a subtly wrong sentence, but it catches the
 * expensive failure cheaply: a confident, specific, invented identifier.
 */
export function checkGrounding(
  message: string,
  toolOutputs: unknown[],
  customerText = '',
): GroundingResult {
  const haystack = toolOutputs.map((o) => JSON.stringify(o ?? null)).join('\n');
  // An order number the customer typed is theirs to be told back. A replacement
  // id is not: repeating one the customer supplied would claim an action happened.
  const echoable = `${haystack}\n${customerText}`;
  const normalisedHaystack = echoable.replace(/[,\s]/g, '');
  const unsupported: string[] = [];

  for (const id of message.match(REPLACEMENT_ID) ?? []) {
    if (!haystack.includes(id)) unsupported.push(id);
  }

  // Scan for order ids only after removing replacement ids: `\b\d{4,}\b` also
  // matches the digits inside REP-9999 and would report the same id twice.
  const withoutReplacementIds = message.replace(REPLACEMENT_ID, ' ');
  for (const id of withoutReplacementIds.match(ORDER_ID) ?? []) {
    if (!echoable.includes(id)) unsupported.push(id);
  }

  for (const match of message.matchAll(MONEY)) {
    const amount = normaliseAmount(match[1] ?? '');
    if (!amount) continue;
    // Tool results carry minor units, so 3,499 has to be found as 349900 too.
    const minor = String(Math.round(Number(amount) * 100));
    if (!normalisedHaystack.includes(amount) && !normalisedHaystack.includes(minor)) {
      unsupported.push(match[0]);
    }
  }

  return { grounded: unsupported.length === 0, unsupported: [...new Set(unsupported)] };
}

export const UNGROUNDED_FALLBACK =
  'I want to be accurate here and I am not able to confirm the details, so I have passed this to a colleague. Someone will come back to you shortly with the right answer.';
