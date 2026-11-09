import { describe, expect, it } from 'vitest';

import { mintApprovalToken } from './approvals';
import { evaluate } from './policy';
import { resetStore } from './store';

/**
 * An agent that times out waiting for an answer often asks again. If its first request is
 * still waiting, or already went through, the same refund must not be paid twice just because
 * it was asked for twice.
 */

const REVIEWER = 'you@company.com';
const ARGS = { customer: 'acme', amount_cents: 4000 };

function refund(store: ReturnType<typeof resetStore>, args: Record<string, unknown> = ARGS) {
  return store.propose({ agent: 'billing-agent', tool: 'refund.create', args, estimatedCostCents: 4000 });
}

const token = (store: ReturnType<typeof resetStore>, id: string) =>
  mintApprovalToken(store.actions().find((a) => a.proposal.id === id)!.proposal, REVIEWER);
const approve = (store: ReturnType<typeof resetStore>, id: string) => store.decide(id, true, REVIEWER, 'ok', token(store, id));
const reject = (store: ReturnType<typeof resetStore>, id: string) => store.decide(id, false, REVIEWER, 'no', token(store, id));

describe('the same action asked for twice', () => {
  it('pays a repeated refund only once, even if a person approves both', () => {
    const store = resetStore();
    const spentBefore = store.budget().spentCents;
    const first = refund(store);
    const second = refund(store);
    approve(store, first.proposal.id);
    if (second.state === 'PENDING_APPROVAL') approve(store, second.proposal.id);
    expect(store.budget().spentCents - spentBefore).toBe(4000);
  });

  it('refuses the repeat while the first is still waiting, and names it', () => {
    const store = resetStore();
    const first = refund(store);
    const second = refund(store);
    expect(second.state).toBe('BLOCKED');
    expect(second.decision.decidedBy).toBe('repeated-request');
    expect(second.decision.reasons.at(-1)).toContain(first.proposal.id);
    expect(second.decision.reasons.at(-1)).toContain('still waiting');
  });

  it('refuses the repeat after the first already went through', () => {
    const store = resetStore();
    const first = refund(store);
    approve(store, first.proposal.id);
    const second = refund(store);
    expect(second.state).toBe('BLOCKED');
    expect(second.decision.reasons.at(-1)).toContain('already went through');
  });

  it('treats argument order as the same request', () => {
    const store = resetStore();
    refund(store, { customer: 'acme', amount_cents: 4000 });
    expect(refund(store, { amount_cents: 4000, customer: 'acme' }).state).toBe('BLOCKED');
  });

  it('lets the agent ask again after a person said no', () => {
    const store = resetStore();
    const first = refund(store);
    reject(store, first.proposal.id);
    expect(refund(store).state).toBe('PENDING_APPROVAL');
  });

  it('lets a genuinely different refund through', () => {
    const store = resetStore();
    refund(store, { customer: 'acme', amount_cents: 4000, order: 'A-1' });
    expect(refund(store, { customer: 'acme', amount_cents: 4000, order: 'A-2' }).state).toBe('PENDING_APPROVAL');
  });

  it('never slows down repeated reads', () => {
    const store = resetStore();
    const read = () => store.propose({ agent: 'billing-agent', tool: 'crm.read', args: { customer: 'acme' }, estimatedCostCents: 0 });
    read();
    expect(read().state).not.toBe('BLOCKED');
  });

  it('keeps the gate pure: the same proposal with no history is unaffected', () => {
    const p = {
      id: 'act_9999',
      agent: 'billing-agent',
      tool: 'refund.create',
      args: ARGS,
      estimatedCostCents: 4000,
      createdAt: new Date().toISOString(),
    };
    const budget = { limitCents: 500_00, spentCents: 0 };
    expect(evaluate(p, budget).verdict).toBe('REQUIRE_APPROVAL');
    expect(evaluate(p, budget, { repeatOf: { id: 'act_0001', state: 'EXECUTED' } }).verdict).toBe('DENY');
  });

  it('writes the refusal to the ledger, and the chain still verifies', () => {
    const store = resetStore();
    refund(store);
    const second = refund(store);
    const events = store.chain().filter((e) => e.proposalId === second.proposal.id).map((e) => e.event);
    expect(events).toContain('BLOCKED');
    expect(store.verify().valid).toBe(true);
  });
});
