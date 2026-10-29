import { describe, expect, it } from 'vitest';

import { mintApprovalToken } from './approvals';
import { ApprovalAuthError, resetStore } from './store';

/**
 * A rejection used to need no token: the reasoning was that saying no can't cause harm. It can.
 * Anyone who could reach the API could reject any pending action under any name, and the
 * hash-chained ledger then recorded "REJECTED by you@company.com", an entry nobody can edit
 * afterwards, but which that person never made. And any agent could quietly kill another
 * agent's pending refund. Now a rejection needs the reviewer's token too, except the agent
 * that asked withdrawing its own request.
 */

const HUMAN = 'you@company.com';

function pending() {
  const store = resetStore();
  const gated = store.propose({
    agent: 'billing-agent',
    tool: 'stripe.refund',
    args: { customer: 'acme', amount_cents: 5_000 },
    estimatedCostCents: 5_000,
  });
  return { store, gated };
}

describe('who may reject', () => {
  it("refuses a rejection in a person's name without their token, and writes nothing", () => {
    const { store, gated } = pending();
    const before = store.chain().length;
    expect(() => store.decide(gated.proposal.id, false, HUMAN, 'not needed')).toThrow(ApprovalAuthError);
    expect(store.actions()[0]?.state).toBe('PENDING_APPROVAL');
    expect(store.chain().length).toBe(before);
  });

  it('refuses a forged token, and a token for a different proposal', () => {
    const { store, gated } = pending();
    const other = store.propose({ agent: 'billing-agent', tool: 'stripe.refund', args: { amount_cents: 1 }, estimatedCostCents: 1 });
    expect(() => store.decide(gated.proposal.id, false, HUMAN, undefined, 'f'.repeat(64))).toThrow(ApprovalAuthError);
    expect(() =>
      store.decide(gated.proposal.id, false, HUMAN, undefined, mintApprovalToken(other.proposal, HUMAN)),
    ).toThrow(ApprovalAuthError);
  });

  it('refuses another agent rejecting work it did not propose', () => {
    const { store, gated } = pending();
    expect(() => store.decide(gated.proposal.id, false, 'support-agent')).toThrow(ApprovalAuthError);
  });

  it("accepts a rejection with the reviewer's token, and records them", () => {
    const { store, gated } = pending();
    const done = store.decide(gated.proposal.id, false, HUMAN, 'duplicate', mintApprovalToken(gated.proposal, HUMAN));
    expect(done?.state).toBe('REJECTED');
    expect(store.chain().at(-1)).toMatchObject({ event: 'REJECTED', actor: HUMAN });
  });

  it('still lets the agent that asked withdraw its own request without a token', () => {
    const { store, gated } = pending();
    expect(store.decide(gated.proposal.id, false, 'Billing-Agent ')?.state).toBe('REJECTED');
    expect(store.chain().at(-1)).toMatchObject({ event: 'REJECTED', actor: 'Billing-Agent ' });
  });
});
