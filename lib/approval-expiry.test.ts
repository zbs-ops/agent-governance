import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mintApprovalToken } from './approvals';
import { APPROVAL_TTL_MS } from './policy';
import { ApprovalAuthError, resetStore } from './store';

/**
 * A pending action used to wait forever. Someone could approve a refund days after it was
 * asked for, when the customer, the order and the reason had all moved on, and the yes
 * would still execute. An approval now only counts within a window of the request.
 */

const REVIEWER = 'you@company.com';
const T0 = new Date('2026-10-23T12:00:00.000Z');

const refund = (store: ReturnType<typeof resetStore>) =>
  store.propose({ agent: 'billing-agent', tool: 'refund.create', args: { customer: 'acme', amount_cents: 2_000 }, estimatedCostCents: 2_000 });

const approve = (store: ReturnType<typeof resetStore>, id: string) =>
  store.decide(id, true, REVIEWER, 'ok', mintApprovalToken(id, REVIEWER));

describe('approvals expire', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it('runs an action approved inside the window', () => {
    const store = resetStore();
    const action = refund(store);
    vi.setSystemTime(new Date(T0.getTime() + APPROVAL_TTL_MS - 60_000));
    expect(approve(store, action.proposal.id)?.state).toBe('EXECUTED');
  });

  it('still runs one approved exactly at the edge of the window', () => {
    const store = resetStore();
    const action = refund(store);
    vi.setSystemTime(new Date(T0.getTime() + APPROVAL_TTL_MS));
    expect(approve(store, action.proposal.id)?.state).toBe('EXECUTED');
  });

  it('blocks a late approval, charges nothing, and says why in the ledger', () => {
    const store = resetStore();
    const spentBefore = store.budget().spentCents;
    const action = refund(store);
    vi.setSystemTime(new Date(T0.getTime() + APPROVAL_TTL_MS + 1));

    const late = approve(store, action.proposal.id);
    expect(late?.state).toBe('BLOCKED');
    expect(late?.decision.decidedBy).toBe('approval-expired');
    expect(store.budget().spentCents).toBe(spentBefore);

    const events = store.chain().filter((e) => e.proposalId === action.proposal.id);
    expect(events.map((e) => e.event)).toContain('BLOCKED');
    expect(events.map((e) => e.event)).not.toContain('EXECUTED');
    expect(JSON.stringify(events.at(-1)?.detail)).toMatch(/expired/i);
    expect(store.verify().valid).toBe(true);
  });

  it('still lets a stale request be rejected, so the queue can be cleared', () => {
    const store = resetStore();
    const action = refund(store);
    vi.setSystemTime(new Date(T0.getTime() + APPROVAL_TTL_MS * 3));
    expect(store.decide(action.proposal.id, false, REVIEWER, 'too old')?.state).toBe('REJECTED');
  });

  it('checks who is approving before it checks the clock', () => {
    const store = resetStore();
    const action = refund(store);
    vi.setSystemTime(new Date(T0.getTime() + APPROVAL_TTL_MS + 1));
    expect(() => store.decide(action.proposal.id, true, REVIEWER, 'ok', 'forged')).toThrow(ApprovalAuthError);
    // A forged attempt changes nothing: the action is still pending.
    expect(store.actions().find((a) => a.proposal.id === action.proposal.id)?.state).toBe('PENDING_APPROVAL');
  });
});
