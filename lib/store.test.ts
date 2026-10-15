import { describe, expect, it } from 'vitest';

import { resetStore } from './store';

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
