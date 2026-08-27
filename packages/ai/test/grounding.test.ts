import { describe, expect, it } from 'vitest';
import { checkGrounding } from '../src/grounding.js';

const toolOutputs = [
  { id: '9832', totalAmountMinor: 349900, currency: 'INR' },
  { id: 'REP-0041', orderId: '9832', status: 'created' },
];

describe('checkGrounding', () => {
  it('passes a message whose ids all came from a tool result', () => {
    const r = checkGrounding(
      'I have arranged a replacement for order 9832. Your reference is REP-0041.',
      toolOutputs,
    );
    expect(r.grounded).toBe(true);
    expect(r.unsupported).toEqual([]);
  });

  it('catches a replacement id no tool ever returned', () => {
    const r = checkGrounding('Your replacement reference is REP-9999.', toolOutputs);
    expect(r.grounded).toBe(false);
    expect(r.unsupported).toContain('REP-9999');
  });

  it('catches an order id no tool ever returned', () => {
    const r = checkGrounding('I have checked order 1234 for you.', toolOutputs);
    expect(r.grounded).toBe(false);
    expect(r.unsupported).toContain('1234');
  });

  it('accepts a money amount that matches the minor units in a tool result', () => {
    const r = checkGrounding('The order came to INR 3,499.', toolOutputs);
    expect(r.grounded).toBe(true);
  });

  it('catches an invented money amount', () => {
    const r = checkGrounding('The order came to INR 9,999.', toolOutputs);
    expect(r.grounded).toBe(false);
    expect(r.unsupported).toContain('INR 9,999');
  });

  it('passes a message with no identifiers at all', () => {
    expect(checkGrounding('A colleague will be with you shortly.', []).grounded).toBe(true);
  });

  it('reports each unsupported value once', () => {
    const r = checkGrounding('REP-9999 and REP-9999 again.', toolOutputs);
    expect(r.unsupported).toEqual(['REP-9999']);
  });

  it('fails everything when no tool ran', () => {
    expect(checkGrounding('Your reference is REP-0041.', []).grounded).toBe(false);
  });
});
