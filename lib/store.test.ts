import { describe, expect, it } from 'vitest';

import { SelfApprovalError, resetStore } from './store';

function pendingRefund() {
  const store = resetStore();
  const gated = store.propose({
    agent: 'billing-agent',
    tool: 'stripe.refund',
    args: { invoice: '7002', amount_cents: 5_000 },
    estimatedCostCents: 5_000,
  });
  return { store, gated };
}

describe('who is allowed to approve', () => {
  // "Who approved this?" is the question the ledger exists to answer. If the agent that
  // proposed an action can also approve it, the honest answer is "nobody", and the log
  // would still say APPROVED.

  it('refuses to let an agent approve its own proposal', () => {
    const { store, gated } = pendingRefund();
    expect(() => store.decide(gated.proposal.id, true, 'billing-agent')).toThrow(SelfApprovalError);
  });

  it('is not fooled by case or whitespace', () => {
    const { store, gated } = pendingRefund();
    expect(() => store.decide(gated.proposal.id, true, '  Billing-Agent ')).toThrow(SelfApprovalError);
  });

  it('leaves the action pending, charges nothing, and records no approval', () => {
    const { store, gated } = pendingRefund();
    const spentBefore = store.budget().spentCents;
    const ledgerBefore = store.chain().length;
    expect(() => store.decide(gated.proposal.id, true, 'billing-agent')).toThrow();
    expect(store.actions().find((a) => a.proposal.id === gated.proposal.id)?.state).toBe('PENDING_APPROVAL');
    expect(store.budget().spentCents).toBe(spentBefore);
    expect(store.chain().length).toBe(ledgerBefore);
  });

  it('still lets an agent withdraw (reject) its own proposal', () => {
    const { store, gated } = pendingRefund();
    expect(store.decide(gated.proposal.id, false, 'billing-agent')?.state).toBe('REJECTED');
  });

  it('lets a different reviewer approve', () => {
    const { store, gated } = pendingRefund();
    expect(store.decide(gated.proposal.id, true, 'you@company.com')?.state).toBe('EXECUTED');
  });
});

describe('what the store charges when an action runs', () => {
  it('charges the real amount of an understated refund once a human approves it', () => {
    const store = resetStore();
    const before = store.budget().spentCents;

    const gated = store.propose({
      agent: 'billing-agent',
      tool: 'stripe.refund',
      args: { invoice: '7001', amount_cents: 9_000 },
      estimatedCostCents: 100,
    });
    expect(gated.state).toBe('PENDING_APPROVAL');
    expect(gated.decision.decidedBy).toBe('cost-understated');

    store.decide(gated.proposal.id, true, 'reviewer');
    // $90.00 actually moved, so $90.00 comes off the budget, not the $1.00 the agent claimed.
    expect(store.budget().spentCents - before).toBe(9_000);
  });

  it('charges the estimate when the arguments name no amount', () => {
    const store = resetStore();
    const before = store.budget().spentCents;
    store.propose({ agent: 'a', tool: 'ticket.create', args: { subject: 'x' }, estimatedCostCents: 250 });
    expect(store.budget().spentCents - before).toBe(250);
  });
});
