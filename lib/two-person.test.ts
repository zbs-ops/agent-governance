import { afterEach, describe, expect, it, vi } from 'vitest';

import { mintApprovalToken } from './approvals';
import { APPROVAL_TTL_MS, TWO_PERSON_ABOVE_CENTS } from './policy';
import { ApprovalAuthError, SameApproverError, SelfApprovalError, resetStore } from './store';

/**
 * One person's yes used to be enough for any amount. A single reviewer who is careless,
 * tricked, or acting alone could move up to the whole budget in one click. Above a threshold,
 * an action now needs two different people to approve it before it runs.
 */

const YOU = 'you@company.com';
const FINANCE = 'finance@company.com';
type S = ReturnType<typeof resetStore>;

function refund(store: S, cents: number, order = 'A-1') {
  return store.propose({ agent: 'billing-agent', tool: 'refund.create', args: { order, amount_cents: cents }, estimatedCostCents: cents });
}
const find = (store: S, id: string) => store.actions().find((a) => a.proposal.id === id)!;
const approve = (store: S, id: string, who: string) => store.decide(id, true, who, 'ok', mintApprovalToken(find(store, id).proposal, who));
const reject = (store: S, id: string, who: string) => store.decide(id, false, who, 'no', mintApprovalToken(find(store, id).proposal, who));

describe('two people for a large action', () => {
  afterEach(() => vi.useRealTimers());

  it('does not run a large refund on one approval', () => {
    const store = resetStore();
    const spent = store.budget().spentCents;
    const a = refund(store, 30_000);
    const after = approve(store, a.proposal.id, YOU);
    expect(after?.state).toBe('PENDING_APPROVAL');
    expect(after?.approvals).toEqual([YOU]);
    expect(store.budget().spentCents).toBe(spent);
  });

  it('runs it once a second, different person approves', () => {
    const store = resetStore();
    const spent = store.budget().spentCents;
    const a = refund(store, 30_000);
    approve(store, a.proposal.id, YOU);
    const after = approve(store, a.proposal.id, FINANCE);
    expect(after?.state).toBe('EXECUTED');
    expect(after?.approvals).toEqual([YOU, FINANCE]);
    expect(store.budget().spentCents - spent).toBe(30_000);
  });

  it('refuses the same person approving twice, and changes nothing', () => {
    const store = resetStore();
    const a = refund(store, 30_000);
    approve(store, a.proposal.id, YOU);
    const ledger = store.chain().length;
    expect(() => approve(store, a.proposal.id, YOU)).toThrow(SameApproverError);
    expect(() => approve(store, a.proposal.id, ' You@Company.com ')).toThrow(SameApproverError);
    expect(find(store, a.proposal.id).state).toBe('PENDING_APPROVAL');
    expect(store.chain()).toHaveLength(ledger);
  });

  it('lets either reviewer stop it after the first yes', () => {
    const store = resetStore();
    const spent = store.budget().spentCents;
    const a = refund(store, 30_000);
    approve(store, a.proposal.id, YOU);
    expect(reject(store, a.proposal.id, FINANCE)?.state).toBe('REJECTED');
    expect(store.budget().spentCents).toBe(spent);
  });

  it('keeps one approval for amounts at or under the threshold', () => {
    const store = resetStore();
    expect(approve(store, refund(store, TWO_PERSON_ABOVE_CENTS).proposal.id, YOU)?.state).toBe('EXECUTED');
    expect(approve(store, refund(store, 12_400, 'B-1').proposal.id, YOU)?.state).toBe('EXECUTED');
  });

  it('counts the real amount, so understating the estimate does not avoid the second person', () => {
    const store = resetStore();
    const a = store.propose({ agent: 'billing-agent', tool: 'refund.create', args: { amount_cents: 30_000 }, estimatedCostCents: 100 });
    expect(approve(store, a.proposal.id, YOU)?.state).toBe('PENDING_APPROVAL');
  });

  it('still refuses the agent as either approver, and an unauthenticated second yes', () => {
    const store = resetStore();
    const a = refund(store, 30_000);
    expect(() => store.decide(a.proposal.id, true, 'billing-agent', 'me', 'x')).toThrow(SelfApprovalError);
    approve(store, a.proposal.id, YOU);
    expect(() => store.decide(a.proposal.id, true, FINANCE, 'ok', mintApprovalToken(a.proposal, YOU))).toThrow(ApprovalAuthError);
    expect(find(store, a.proposal.id).state).toBe('PENDING_APPROVAL');
  });

  it('re-checks the budget when the second yes arrives', () => {
    const store = resetStore();
    const big = refund(store, 30_000);
    approve(store, big.proposal.id, YOU);
    // While it waits for a second person, other approved spend leaves too little room.
    approve(store, refund(store, 12_400, 'B-1').proposal.id, YOU);
    approve(store, refund(store, 12_400, 'B-2').proposal.id, YOU);
    const after = approve(store, big.proposal.id, FINANCE);
    expect(after?.state).toBe('BLOCKED');
    expect(after?.decision.decidedBy).toBe('budget-exceeded-at-approval');
  });

  it('needs both approvals inside the approval window', () => {
    vi.useFakeTimers();
    const t0 = new Date('2026-11-10T12:00:00.000Z');
    vi.setSystemTime(t0);
    const store = resetStore();
    const a = refund(store, 30_000);
    approve(store, a.proposal.id, YOU);
    vi.setSystemTime(new Date(t0.getTime() + APPROVAL_TTL_MS + 60_000));
    const after = approve(store, a.proposal.id, FINANCE);
    expect(after?.state).toBe('BLOCKED');
    expect(after?.decision.decidedBy).toBe('approval-expired');
  });

  it('records both approvals in the ledger, and the chain still verifies', () => {
    const store = resetStore();
    const a = refund(store, 30_000);
    approve(store, a.proposal.id, YOU);
    approve(store, a.proposal.id, FINANCE);
    const mine = store.chain().filter((e) => e.proposalId === a.proposal.id);
    const approvals = mine.filter((e) => e.event === 'APPROVED');
    expect(approvals.map((e) => e.actor)).toEqual([YOU, FINANCE]);
    expect(approvals.map((e) => e.detail.approval)).toEqual(['1 of 2', '2 of 2']);
    expect(mine.at(-1)?.event).toBe('EXECUTED');
    expect(store.verify().valid).toBe(true);
  });

  it('leaves a one-approval ledger entry exactly as before', () => {
    const store = resetStore();
    const a = refund(store, 2_000);
    approve(store, a.proposal.id, YOU);
    const entry = store.chain().find((e) => e.proposalId === a.proposal.id && e.event === 'APPROVED');
    expect(entry?.detail).toEqual({ note: 'ok' });
  });
});
