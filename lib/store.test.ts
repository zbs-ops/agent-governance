import { describe, expect, it } from 'vitest';

import { mintApprovalToken } from './approvals';
import { ApprovalAuthError, SelfApprovalError, resetStore } from './store';

const HUMAN = 'you@company.com';
const approve = (id: string) => mintApprovalToken(id, HUMAN);

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

  it('lets a different, authenticated reviewer approve', () => {
    const { store, gated } = pendingRefund();
    const id = gated.proposal.id;
    expect(store.decide(id, true, HUMAN, undefined, approve(id))?.state).toBe('EXECUTED');
  });
});

describe('authenticating the approver', () => {
  // PR #4 stopped an agent approving as itself; this stops it approving as someone else.
  // An approval must carry a token only the named reviewer's key can produce.

  it('refuses an approval with no token', () => {
    const { store, gated } = pendingRefund();
    expect(() => store.decide(gated.proposal.id, true, HUMAN)).toThrow(ApprovalAuthError);
  });

  it('refuses a made-up token', () => {
    const { store, gated } = pendingRefund();
    expect(() => store.decide(gated.proposal.id, true, HUMAN, undefined, 'not-a-real-token')).toThrow(
      ApprovalAuthError,
    );
  });

  it("refuses a token minted for a different proposal (no replay)", () => {
    const { store, gated } = pendingRefund();
    const other = store.propose({
      agent: 'billing-agent',
      tool: 'stripe.refund',
      args: { invoice: '7003', amount_cents: 5_000 },
      estimatedCostCents: 5_000,
    });
    const wrongProposalToken = mintApprovalToken(other.proposal.id, HUMAN);
    expect(() => store.decide(gated.proposal.id, true, HUMAN, undefined, wrongProposalToken)).toThrow(
      ApprovalAuthError,
    );
  });

  it('refuses an unregistered reviewer even if they send a token', () => {
    const { store, gated } = pendingRefund();
    expect(() => store.decide(gated.proposal.id, true, 'stranger', undefined, 'anything')).toThrow(
      ApprovalAuthError,
    );
  });

  it('records nothing and charges nothing when the token is bad', () => {
    const { store, gated } = pendingRefund();
    const spentBefore = store.budget().spentCents;
    const ledgerBefore = store.chain().length;
    expect(() => store.decide(gated.proposal.id, true, HUMAN)).toThrow();
    expect(store.budget().spentCents).toBe(spentBefore);
    expect(store.chain().length).toBe(ledgerBefore);
  });

  it('needs no token to reject', () => {
    const { store, gated } = pendingRefund();
    expect(store.decide(gated.proposal.id, false, HUMAN)?.state).toBe('REJECTED');
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

    store.decide(gated.proposal.id, true, HUMAN, undefined, approve(gated.proposal.id));
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
