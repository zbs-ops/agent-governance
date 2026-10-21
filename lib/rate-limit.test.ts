import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UNATTENDED_WRITE_LIMIT, evaluate } from './policy';
import { resetStore } from './store';
import type { ActionProposal, Budget } from './types';

const BUDGET: Budget = { spentCents: 0, limitCents: 50_000 };

function proposal(tool: string): ActionProposal {
  return { id: 'act_test', agent: 'support-agent', tool, args: {}, estimatedCostCents: 0, createdAt: '2026-01-01T00:00:00.000Z' };
}

describe('the gate: a runaway loop of unattended writes', () => {
  // Tier-2 writes run without a human. One is fine; an agent stuck in a loop creating
  // hundreds of tickets is not, and nothing stopped it. Past a limit in the window, the next
  // unattended write waits for a person.

  it('allows unattended writes under the limit', () => {
    const d = evaluate(proposal('ticket.create'), BUDGET, { recentUnattendedWrites: UNATTENDED_WRITE_LIMIT - 1 });
    expect(d.verdict).toBe('ALLOW');
  });

  it('escalates the write that would go over the limit', () => {
    const d = evaluate(proposal('ticket.create'), BUDGET, { recentUnattendedWrites: UNATTENDED_WRITE_LIMIT });
    expect(d.verdict).toBe('REQUIRE_APPROVAL');
    expect(d.decidedBy).toBe('unattended-rate');
    expect(d.reasons.join(' ')).toContain(String(UNATTENDED_WRITE_LIMIT));
  });

  it('never slows down reads, which cannot change anything', () => {
    const d = evaluate(proposal('crm.read'), BUDGET, { recentUnattendedWrites: UNATTENDED_WRITE_LIMIT * 5 });
    expect(d.verdict).toBe('ALLOW');
  });

  it('behaves exactly as before when no history is passed', () => {
    expect(evaluate(proposal('ticket.create'), BUDGET).verdict).toBe('ALLOW');
  });
});

describe('the store: counting writes per agent, per window', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  const write = (store: ReturnType<typeof resetStore>, agent: string) =>
    store.propose({ agent, tool: 'ticket.create', args: { subject: 'x' }, estimatedCostCents: 0 });

  it('lets the first writes through and holds the one past the limit', () => {
    const store = resetStore();
    for (let i = 0; i < UNATTENDED_WRITE_LIMIT; i += 1) expect(write(store, 'loopy-agent').state).toBe('EXECUTED');
    const next = write(store, 'loopy-agent');
    expect(next.state).toBe('PENDING_APPROVAL');
    expect(next.decision.decidedBy).toBe('unattended-rate');
  });

  it('counts each agent separately', () => {
    const store = resetStore();
    for (let i = 0; i < UNATTENDED_WRITE_LIMIT; i += 1) write(store, 'loopy-agent');
    expect(write(store, 'other-agent').state).toBe('EXECUTED');
  });

  it('lets writes through again once the window has passed', () => {
    const store = resetStore();
    for (let i = 0; i < UNATTENDED_WRITE_LIMIT; i += 1) write(store, 'loopy-agent');
    vi.setSystemTime(new Date('2026-10-21T12:01:01.000Z'));
    expect(write(store, 'loopy-agent').state).toBe('EXECUTED');
  });
});
