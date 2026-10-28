import { describe, expect, it } from 'vitest';

import { mintApprovalToken, verifyApprovalToken } from './approvals';
import type { ActionProposal } from './types';
import { ApprovalAuthError, resetStore } from './store';

/**
 * An approval token used to be signed over the proposal id and the reviewer, nothing else.
 * Ids are a counter (act_0001, act_0002, ...) that starts again on every reset, and the demo
 * resets on every cold start. So a token someone approved a $5 refund with could later
 * approve a completely different act_0001: a $450 refund to someone else. The token now
 * covers what is being approved, not just its number.
 */

const REVIEWER = 'you@company.com';

const refund = (store: ReturnType<typeof resetStore>, customer: string, cents: number) =>
  store.propose({
    agent: 'billing-agent',
    tool: 'stripe.refund',
    args: { customer, amount_cents: cents },
    estimatedCostCents: cents,
  });

describe('an approval token covers what was approved', () => {
  it('does not carry over to a different action that reuses the id after a reset', () => {
    let store = resetStore();
    const small = refund(store, 'acme', 500);
    const oldToken = mintApprovalToken(small.proposal, REVIEWER);

    store = resetStore();
    const big = refund(store, 'someone-else', 45_000);
    expect(big.proposal.id).toBe(small.proposal.id); // the counter really does repeat

    expect(() => store.decide(big.proposal.id, true, REVIEWER, undefined, oldToken)).toThrow(ApprovalAuthError);
    expect(store.budget().spentCents).toBe(0);
    expect(store.actions()[0]?.state).toBe('PENDING_APPROVAL');
  });

  it('still approves the action it was minted for', () => {
    const store = resetStore();
    const gated = refund(store, 'acme', 500);
    const done = store.decide(gated.proposal.id, true, REVIEWER, 'ok', mintApprovalToken(gated.proposal, REVIEWER));
    expect(done?.state).toBe('EXECUTED');
  });

  const base: ActionProposal = {
    id: 'act_0001',
    agent: 'billing-agent',
    tool: 'stripe.refund',
    args: { customer: 'acme', amount_cents: 500 },
    estimatedCostCents: 500,
    createdAt: '2026-10-28T05:00:00.000Z',
  };
  const token = mintApprovalToken(base, REVIEWER);

  it.each<[string, ActionProposal]>([
    ['a different amount', { ...base, args: { ...base.args, amount_cents: 45_000 } }],
    ['a different customer', { ...base, args: { ...base.args, customer: 'someone-else' } }],
    ['an extra argument', { ...base, args: { ...base.args, note: 'also refund the rest' } }],
    ['a different tool', { ...base, tool: 'stripe.payout' }],
    ['a different agent', { ...base, agent: 'other-agent' }],
    ['a different estimate', { ...base, estimatedCostCents: 1 }],
    ['a different request time', { ...base, createdAt: '2026-10-28T06:00:00.000Z' }],
  ])('rejects the token for %s', (_, changed) => {
    expect(verifyApprovalToken(changed, REVIEWER, token)).toBe(false);
  });

  it('does not depend on the order the arguments were written in', () => {
    const reordered: ActionProposal = { ...base, args: { amount_cents: 500, customer: 'acme' } };
    expect(verifyApprovalToken(reordered, REVIEWER, token)).toBe(true);
  });
});
