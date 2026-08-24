import { describe, expect, it } from 'vitest';

import { evaluate } from './policy';
import type { ActionProposal, Budget } from './types';

const BUDGET: Budget = { spentCents: 0, limitCents: 50_000 };

function proposal(tool: string, estimatedCostCents = 0): ActionProposal {
  return {
    id: 'act_test',
    agent: 'test-agent',
    tool,
    args: {},
    estimatedCostCents,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('what runs unattended', () => {
  it('lets reads through', () => {
    expect(evaluate(proposal('crm.read'), BUDGET).verdict).toBe('ALLOW');
    expect(evaluate(proposal('db.query'), BUDGET).tier).toBe(1);
  });

  it('matches a namespace wildcard', () => {
    expect(evaluate(proposal('search.web'), BUDGET).verdict).toBe('ALLOW');
  });

  it('lets internal writes through, at tier 2', () => {
    const decision = evaluate(proposal('ticket.create'), BUDGET);
    expect(decision.verdict).toBe('ALLOW');
    expect(decision.tier).toBe(2);
  });
});

describe('what waits for a human', () => {
  it.each(['stripe.refund', 'refund.issue', 'payout.create'])('holds %s', (tool) => {
    expect(evaluate(proposal(tool, 100), BUDGET).verdict).toBe('REQUIRE_APPROVAL');
  });

  it('holds anything sent to a customer, because it cannot be unsent', () => {
    expect(evaluate(proposal('email.send'), BUDGET).verdict).toBe('REQUIRE_APPROVAL');
    expect(evaluate(proposal('sms.send'), BUDGET).verdict).toBe('REQUIRE_APPROVAL');
  });

  it('holds destructive operations', () => {
    expect(evaluate(proposal('db.delete'), BUDGET).verdict).toBe('REQUIRE_APPROVAL');
    expect(evaluate(proposal('deploy.production'), BUDGET).verdict).toBe('REQUIRE_APPROVAL');
  });

  it('escalates one unusually large spend even when it fits the budget', () => {
    // A quarter of the cap in a single action. Affordable, still worth a look.
    const decision = evaluate(proposal('crm.update', 20_000), BUDGET);
    expect(decision.verdict).toBe('REQUIRE_APPROVAL');
    expect(decision.decidedBy).toBe('large-single-spend');
  });
});

describe('what gets refused outright', () => {
  it('refuses a tool that is not on the list — no benefit of the doubt', () => {
    const decision = evaluate(proposal('crypto.transfer'), BUDGET);
    expect(decision.verdict).toBe('DENY');
    expect(decision.decidedBy).toBe('unknown-tool');
  });

  it('refuses anything that would break the budget', () => {
    const nearlySpent: Budget = { spentCents: 49_000, limitCents: 50_000 };
    const decision = evaluate(proposal('crm.update', 5_000), nearlySpent);
    expect(decision.verdict).toBe('DENY');
    expect(decision.decidedBy).toBe('budget-exceeded');
  });

  it('checks the budget before it weighs the tier, so a runaway agent stops first', () => {
    const nearlySpent: Budget = { spentCents: 49_999, limitCents: 50_000 };
    // A tier-1 read would normally sail through.
    expect(evaluate(proposal('crm.read', 500), nearlySpent).decidedBy).toBe('budget-exceeded');
  });

  it('allows spend that lands exactly on the cap', () => {
    const nearlySpent: Budget = { spentCents: 49_000, limitCents: 50_000 };
    expect(evaluate(proposal('crm.read', 1_000), nearlySpent).verdict).toBe('ALLOW');
  });
});

describe('the properties that make it trustworthy', () => {
  it('is deterministic — the same proposal always decides the same way', () => {
    const p = proposal('refund.issue', 4_000);
    const first = evaluate(p, BUDGET);
    const second = evaluate(p, BUDGET);
    expect(first).toEqual(second);
  });

  it('always explains itself, because the reason ends up in the audit log', () => {
    for (const tool of ['crm.read', 'refund.issue', 'db.drop', 'nonsense.tool']) {
      expect(evaluate(proposal(tool), BUDGET).reasons.length).toBeGreaterThan(0);
    }
  });

  it('never returns a verdict outside the three it is allowed to give', () => {
    for (const tool of ['crm.read', 'ticket.create', 'stripe.refund', 'made.up']) {
      expect(['ALLOW', 'REQUIRE_APPROVAL', 'DENY']).toContain(evaluate(proposal(tool), BUDGET).verdict);
    }
  });
});
