import { describe, expect, it } from 'vitest';

import { mintApprovalToken } from './approvals';
import { resetStore } from './store';

/**
 * #16 made payments to the same target add up for the two-person rule, but "same target" meant
 * the same tool with exactly the same arguments apart from the amount. Changing anything else
 * (a reason, a note, a request id, the case of the order number, the refund tool) or leaving the
 * order out made the second part look like a different target, and it ran on one approval.
 * A target is now who the money goes to: payments that share an order, invoice, customer,
 * account or recipient add up, whatever tool or other details they use.
 */

const YOU = 'you@company.com';
type S = ReturnType<typeof resetStore>;

function pay(store: S, tool: string, args: Record<string, unknown>, cents: number) {
  return store.propose({ agent: 'billing-agent', tool, args: { ...args, amount_cents: cents }, estimatedCostCents: cents });
}
const approve = (store: S, id: string) =>
  store.decide(id, true, YOU, 'ok', mintApprovalToken(store.actions().find((a) => a.proposal.id === id)!.proposal, YOU));

function secondPart(first: [string, Record<string, unknown>], second: [string, Record<string, unknown>]) {
  const store = resetStore();
  expect(approve(store, pay(store, first[0], first[1], 20_000).proposal.id)?.state).toBe('EXECUTED');
  return approve(store, pay(store, second[0], second[1], 10_000).proposal.id)?.state;
}

describe('what counts as the same target', () => {
  it.each([
    ['a different reason', { order: 'A-1', reason: 'damaged' }, { order: 'A-1', reason: 'late delivery' }],
    ['a note added', { order: 'A-1' }, { order: 'A-1', note: 'follow-up' }],
    ['a new request id', { order: 'A-1', request_id: 'r1' }, { order: 'A-1', request_id: 'r2' }],
    ['the order number in lower case', { order: 'A-1' }, { order: 'a-1' }],
    ['spaces around the order number', { order: 'A-1' }, { order: ' A-1 ' }],
    ['the order left out, same customer', { customer: 'acme', order: 'A-1' }, { customer: 'acme' }],
    ['the same invoice by another key', { invoice: '8842' }, { invoice: '8842', customer: 'acme' }],
  ])('%s still needs a second person', (_label, first, second) => {
    expect(secondPart(['refund.create', first], ['refund.create', second])).toBe('PENDING_APPROVAL');
  });

  it.each([
    ['stripe.refund'],
    ['refund.issue'],
    ['payout.send'],
  ])('switching to %s for the second part still needs a second person', (tool) => {
    expect(secondPart(['refund.create', { order: 'A-1' }], [tool, { order: 'A-1' }])).toBe('PENDING_APPROVAL');
  });

  it('two orders for the same customer add up too', () => {
    expect(secondPart(['refund.create', { customer: 'acme', order: 'A-1' }], ['refund.create', { customer: 'acme', order: 'B-2' }])).toBe(
      'PENDING_APPROVAL',
    );
  });

  it.each([
    ['different orders, no customer', { order: 'A-1' }, { order: 'B-2' }],
    ['different customers', { customer: 'acme' }, { customer: 'globex' }],
    ['an identifier key with a different value', { invoice: '8842' }, { invoice: '9001' }],
  ])('%s stay separate', (_label, first, second) => {
    expect(secondPart(['refund.create', first], ['refund.create', second])).toBe('EXECUTED');
  });

  it('with no identifier at all, the old exact match still applies', () => {
    expect(secondPart(['refund.create', { batch: 'x' }], ['refund.create', { batch: 'x' }])).toBe('PENDING_APPROVAL');
    expect(secondPart(['refund.create', { batch: 'x' }], ['refund.create', { batch: 'y' }])).toBe('EXECUTED');
  });
});
