import { describe, expect, it } from 'vitest';

import { mintApprovalToken } from './approvals';
import { resetStore } from './store';

/**
 * The budget is checked when an action is proposed. A tier-3 action then waits for a person,
 * sometimes for a long time, and meanwhile other actions spend. Two refunds that each fit
 * when proposed could both be approved and push spend past the cap. The cap has to hold at
 * the moment the money moves, not only at the moment it was asked for.
 */

const REVIEWER = 'you@company.com';

function refund(store: ReturnType<typeof resetStore>, cents: number) {
  return store.propose({
    agent: 'billing-agent',
    tool: 'refund.create',
    args: { customer: 'acme', amount_cents: cents },
    estimatedCostCents: cents,
  });
}

const approve = (store: ReturnType<typeof resetStore>, id: string) =>
  store.decide(id, true, REVIEWER, 'ok', mintApprovalToken(store.actions().find((a) => a.proposal.id === id)!.proposal, REVIEWER));

describe('approving after the budget has moved', () => {
  it('blocks the approval that would push spend past the cap, and charges nothing', () => {
    const store = resetStore();
    const { limitCents, spentCents } = store.budget();
    const each = Math.floor((limitCents - spentCents) * 0.6); // each fits alone, not both

    const first = refund(store, each);
    const second = refund(store, each);
    expect(first.state).toBe('PENDING_APPROVAL');
    expect(second.state).toBe('PENDING_APPROVAL');

    expect(approve(store, first.proposal.id)?.state).toBe('EXECUTED');
    const spentAfterFirst = store.budget().spentCents;

    const late = approve(store, second.proposal.id);
    expect(late?.state).toBe('BLOCKED');
    expect(late?.decision.decidedBy).toBe('budget-exceeded-at-approval');
    expect(store.budget().spentCents).toBe(spentAfterFirst);
    expect(store.budget().spentCents).toBeLessThanOrEqual(limitCents);
  });

  it('says why in the ledger, and the chain still verifies', () => {
    const store = resetStore();
    const { limitCents, spentCents } = store.budget();
    const each = Math.floor((limitCents - spentCents) * 0.6);
    const first = refund(store, each);
    const second = refund(store, each);
    approve(store, first.proposal.id);
    approve(store, second.proposal.id);

    const entries = store.chain().filter((e) => e.proposalId === second.proposal.id);
    const events = entries.map((e) => e.event);
    expect(events).toContain('APPROVED');
    expect(events).toContain('BLOCKED');
    expect(events).not.toContain('EXECUTED');
    expect(JSON.stringify(entries.at(-1)?.detail)).toMatch(/budget/i);
    expect(store.verify().valid).toBe(true);
  });

  it('still runs an approved action that fits when it is approved', () => {
    const store = resetStore();
    const { limitCents, spentCents } = store.budget();
    const each = Math.floor((limitCents - spentCents) * 0.4); // both fit together
    const first = refund(store, each);
    const second = refund(store, each);
    expect(approve(store, first.proposal.id)?.state).toBe('EXECUTED');
    expect(approve(store, second.proposal.id)?.state).toBe('EXECUTED');
  });

  it('lands exactly on the cap and no further', () => {
    const store = resetStore();
    const { limitCents, spentCents } = store.budget();
    const remaining = limitCents - spentCents;
    const big = refund(store, remaining - 100);
    const small = refund(store, 100);
    const over = refund(store, 1);
    expect(approve(store, big.proposal.id)?.state).toBe('EXECUTED');
    expect(approve(store, small.proposal.id)?.state).toBe('EXECUTED');
    expect(store.budget().spentCents).toBe(limitCents);
    expect(approve(store, over.proposal.id)?.state).toBe('BLOCKED');
  });
});
