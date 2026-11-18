import { describe, expect, it } from 'vitest';

import { mintApprovalToken } from './approvals';
import { resetStore } from './store';

/**
 * #17 matched a target by the exact argument name, so the same order written another way looked
 * like a different target and the second part of a split ran on one approval: `order` then
 * `order_id`, camelCase names (`orderId`, `customerId`, common in JavaScript APIs, which also
 * fell back to the exact match so a new reason slipped through), or a capitalised name. The name
 * is now read as what it identifies (order, invoice, customer, ...).
 */

const YOU = 'you@company.com';
type S = ReturnType<typeof resetStore>;

function pay(store: S, tool: string, args: Record<string, unknown>, cents: number) {
  return store.propose({ agent: 'billing-agent', tool, args: { ...args, amount_cents: cents }, estimatedCostCents: cents });
}
const approve = (store: S, id: string) =>
  store.decide(id, true, YOU, 'ok', mintApprovalToken(store.actions().find((a) => a.proposal.id === id)!.proposal, YOU));

function secondPart(first: Record<string, unknown>, second: Record<string, unknown>) {
  const store = resetStore();
  expect(approve(store, pay(store, 'refund.create', first, 20_000).proposal.id)?.state).toBe('EXECUTED');
  return approve(store, pay(store, 'refund.create', second, 10_000).proposal.id)?.state;
}

describe('the same target written another way', () => {
  it.each([
    ['order, then order_id', { order: 'T-1' }, { order_id: 'T-1' }],
    ['order_id, then order', { order_id: 'T-1' }, { order: 'T-1' }],
    ['customer, then customer_id', { customer: 'acme' }, { customer_id: 'acme' }],
    ['invoice, then invoice_id', { invoice: '8842' }, { invoice_id: '8842' }],
    ['order, then orderId', { order: 'T-1' }, { orderId: 'T-1' }],
    ['orderId both times with a new reason', { orderId: 'T-1', reason: 'a' }, { orderId: 'T-1', reason: 'b' }],
    ['customerId both times with a note', { customerId: 'acme' }, { customerId: 'acme', note: 'x' }],
    ['ORDER_ID in capitals', { order: 'T-1' }, { ORDER_ID: 'T-1' }],
    ['payment_intent, then paymentIntentId', { payment_intent: 'pi_1' }, { paymentIntentId: 'pi_1' }],
  ])('%s still needs a second person', (_label, first, second) => {
    expect(secondPart(first, second)).toBe('PENDING_APPROVAL');
  });

  it.each([
    ['different orders under different spellings', { order: 'T-1' }, { orderId: 'T-2' }],
    ['the same value naming different things', { order: '42' }, { invoice: '42' }],
    ['a field that only ends in "id"', { order: 'T-1' }, { paid: 'T-1' }],
  ])('%s stay separate', (_label, first, second) => {
    expect(secondPart(first, second)).toBe('EXECUTED');
  });
});
