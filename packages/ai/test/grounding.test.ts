import { describe, expect, it } from 'vitest';
import { checkGrounding } from '../src/grounding.js';

const toolOutputs = [
  {
    id: 'sub_7H21',
    status: 'active',
    latestInvoiceId: 'in_9K81',
    items: [{ subscriptionItemId: 'si_1S', priceId: 'price_2S', productId: 'prod_9P' }],
  },
  { refundId: 're_3T55', status: 'succeeded', amountMinor: 349900, currency: 'INR' },
  {
    lines: [{ amountMinor: -45000, description: 'Unused time on Pro plan', proration: true }],
    prorationCreditMinor: -45000,
    nextChargeMinor: 304900,
  },
];

describe('checkGrounding', () => {
  it('passes a message whose ids all came from a tool result', () => {
    const r = checkGrounding(
      'I have arranged a refund for subscription sub_7H21. Your reference is re_3T55.',
      toolOutputs,
    );
    expect(r.grounded).toBe(true);
    expect(r.unsupported).toEqual([]);
  });

  it('catches a refund id no tool ever returned', () => {
    const r = checkGrounding('Your refund reference is re_9999.', toolOutputs);
    expect(r.grounded).toBe(false);
    expect(r.unsupported).toContain('re_9999');
  });

  it('catches a subscription id no tool ever returned', () => {
    const r = checkGrounding('I have checked subscription sub_0000 for you.', toolOutputs);
    expect(r.grounded).toBe(false);
    expect(r.unsupported).toContain('sub_0000');
  });

  it('catches an invoice id no tool ever returned', () => {
    const r = checkGrounding('Invoice in_0000 shows the charge.', toolOutputs);
    expect(r.grounded).toBe(false);
    expect(r.unsupported).toContain('in_0000');
  });

  it('lets the reply echo an id the customer named', () => {
    const r = checkGrounding(
      'I am looking at subscription sub_0000 now.',
      toolOutputs,
      'please check my subscription sub_0000',
    );
    expect(r.grounded).toBe(true);
  });

  it('accepts a money amount that matches the minor units in a tool result', () => {
    const r = checkGrounding('The refund is INR 3,499.', toolOutputs);
    expect(r.grounded).toBe(true);
  });

  it('catches an invented money amount', () => {
    const r = checkGrounding('The refund is INR 9,999.', toolOutputs);
    expect(r.grounded).toBe(false);
    expect(r.unsupported).toContain('INR 9,999');
  });

  it('catches an amount whose minor units do not match, even when the digits overlap', () => {
    const r = checkGrounding('The refund is INR 349.', toolOutputs);
    expect(r.grounded).toBe(false);
    expect(r.unsupported).toContain('INR 349');
  });

  it('catches an invented amount written without a currency marker', () => {
    const r = checkGrounding('We have refunded 9,999 to your card.', toolOutputs);
    expect(r.grounded).toBe(false);
    expect(r.unsupported).toContain('9,999');
  });

  it('accepts a bare amount that matches a tool result', () => {
    const r = checkGrounding('We have refunded 3,499 to your card.', toolOutputs);
    expect(r.grounded).toBe(true);
  });

  it('does not read a plain count as an amount', () => {
    const r = checkGrounding('Refunds are available within 30 days of the charge.', toolOutputs);
    expect(r.grounded).toBe(true);
  });

  it('accepts a plan name quoted from a tool result', () => {
    const r = checkGrounding('You are moving to the Pro plan.', toolOutputs);
    expect(r.grounded).toBe(true);
  });

  it('catches an invented plan name', () => {
    const r = checkGrounding('You are moving to the Enterprise plan.', toolOutputs);
    expect(r.grounded).toBe(false);
    expect(r.unsupported).toContain('Enterprise plan');
  });

  it('ignores generic mentions that name no plan', () => {
    expect(checkGrounding('The plan is active.', []).grounded).toBe(true);
  });

  it('passes a message with no identifiers at all', () => {
    expect(checkGrounding('A colleague will be with you shortly.', []).grounded).toBe(true);
  });

  it('reports each unsupported value once', () => {
    const r = checkGrounding('re_9999 and re_9999 again.', toolOutputs);
    expect(r.unsupported).toEqual(['re_9999']);
  });

  it('fails everything when no tool ran', () => {
    expect(checkGrounding('Your reference is re_3T55.', []).grounded).toBe(false);
  });
});
