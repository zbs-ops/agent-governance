import { afterEach, describe, expect, it, vi } from 'vitest';

import { mintApprovalToken } from './approvals';
import { APPROVAL_TTL_MS, TWO_PERSON_ABOVE_CENTS } from './policy';
import { SameApproverError, resetStore } from './store';

/**
 * The two-person rule looked at one action at a time. A $300 refund needed two reviewers, but
 * the same $300 sent to the same order as $200 then $100 needed only one: each part is under
 * the $250 line, and they aren't repeats of each other because the amounts differ. Payments
 * of the same kind to the same target now add up within the approval window: once what has
 * already gone through plus this one would pass the line, this one needs a second person.
 */

const YOU = 'you@company.com';
const FINANCE = 'finance@company.com';
type S = ReturnType<typeof resetStore>;

function refund(store: S, cents: number, order = 'A-1', agent = 'billing-agent') {
  return store.propose({ agent, tool: 'refund.create', args: { order, amount_cents: cents }, estimatedCostCents: cents });
}
const find = (store: S, id: string) => store.actions().find((a) => a.proposal.id === id)!;
const approve = (store: S, id: string, who: string) =>
  store.decide(id, true, who, 'ok', mintApprovalToken(find(store, id).proposal, who));

describe('splitting a large payment into smaller ones', () => {
  afterEach(() => vi.useRealTimers());

  it('a $300 refund split as $200 + $100 for the same order needs two people for the second part', () => {
    const store = resetStore();
    const spent = store.budget().spentCents;
    const first = refund(store, 20_000);
    expect(approve(store, first.proposal.id, YOU)?.state).toBe('EXECUTED');
    const second = refund(store, 10_000);
    const after = approve(store, second.proposal.id, YOU);
    expect(after?.state).toBe('PENDING_APPROVAL');
    expect(after?.approvals).toEqual([YOU]);
    expect(store.budget().spentCents - spent).toBe(20_000);
    expect(approve(store, second.proposal.id, FINANCE)?.state).toBe('EXECUTED');
    expect(store.budget().spentCents - spent).toBe(30_000);
  });

  it('the same reviewer approving the split part twice is refused, as for one large refund', () => {
    const store = resetStore();
    approve(store, refund(store, 20_000).proposal.id, YOU);
    const second = refund(store, 10_000);
    approve(store, second.proposal.id, YOU);
    expect(() => approve(store, second.proposal.id, YOU)).toThrow(SameApproverError);
  });

  it('three small parts are caught on the one that crosses the line', () => {
    // Different amounts: an identical second request would be refused as a repeat anyway.
    const store = resetStore();
    expect(approve(store, refund(store, 10_000).proposal.id, YOU)?.state).toBe('EXECUTED');
    expect(approve(store, refund(store, 9_999).proposal.id, YOU)?.state).toBe('EXECUTED');
    const third = refund(store, 5_002); // $199.99 already sent + $50.02 = $250.01
    expect(approve(store, third.proposal.id, YOU)?.state).toBe('PENDING_APPROVAL');
  });

  it('up to the line exactly, one approval is still enough', () => {
    const store = resetStore();
    expect(approve(store, refund(store, 20_000).proposal.id, YOU)?.state).toBe('EXECUTED');
    const rest = refund(store, TWO_PERSON_ABOVE_CENTS - 20_000);
    expect(approve(store, rest.proposal.id, YOU)?.state).toBe('EXECUTED');
  });

  it('it counts what other agents sent to the same order too', () => {
    const store = resetStore();
    approve(store, refund(store, 20_000, 'A-1', 'billing-agent').proposal.id, YOU);
    const other = refund(store, 10_000, 'A-1', 'support-agent');
    expect(approve(store, other.proposal.id, YOU)?.state).toBe('PENDING_APPROVAL');
  });

  it('refunds to different orders stay separate', () => {
    const store = resetStore();
    approve(store, refund(store, 20_000, 'A-1').proposal.id, YOU);
    const other = refund(store, 10_000, 'B-2');
    expect(approve(store, other.proposal.id, YOU)?.state).toBe('EXECUTED');
  });

  it('only money that actually went through counts: a rejected or waiting part does not', () => {
    const store = resetStore();
    const rejected = refund(store, 20_000);
    store.decide(rejected.proposal.id, false, YOU, 'no', mintApprovalToken(rejected.proposal, YOU));
    refund(store, 15_000); // still waiting
    const next = refund(store, 10_000);
    expect(approve(store, next.proposal.id, YOU)?.state).toBe('EXECUTED');
  });

  it('parts older than the approval window no longer add up', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
    const store = resetStore();
    approve(store, refund(store, 20_000).proposal.id, YOU);
    vi.setSystemTime(Date.now() + APPROVAL_TTL_MS + 1);
    const later = refund(store, 10_000);
    expect(approve(store, later.proposal.id, YOU)?.state).toBe('EXECUTED');
  });

  it('the ledger says why the second person is needed', () => {
    const store = resetStore();
    approve(store, refund(store, 20_000).proposal.id, YOU);
    const second = refund(store, 10_000);
    approve(store, second.proposal.id, YOU);
    const entry = store.chain().at(-1)!;
    expect(entry.event).toBe('APPROVED');
    expect(entry.detail).toMatchObject({ approval: '1 of 2' });
    expect(String((entry.detail as { why?: string }).why)).toContain('$200.00 already went to the same target');
  });
});
