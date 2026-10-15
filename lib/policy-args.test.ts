import { describe, expect, it } from 'vitest';

import { evaluate } from './policy';
import type { ActionProposal, Budget } from './types';

const BUDGET: Budget = { spentCents: 0, limitCents: 50_000 };

function proposal(
  tool: string,
  estimatedCostCents: number,
  args: Record<string, unknown>,
): ActionProposal {
  return {
    id: 'act_test',
    agent: 'test-agent',
    tool,
    args,
    estimatedCostCents,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('the cost the arguments reveal', () => {
  // The estimate is the agent's own number; amount_cents is what the call will actually
  // move. An agent that says "$1" while asking to refund $400 has told the gate two
  // different things, and only one of them is the money.

  it('escalates an understated cost even on a tool that would normally run unattended', () => {
    const decision = evaluate(proposal('ticket.create', 0, { amount_cents: 500 }), BUDGET);
    expect(decision.verdict).toBe('REQUIRE_APPROVAL');
    expect(decision.decidedBy).toBe('cost-understated');
  });

  it('shows the human the real amount, not the estimate', () => {
    const decision = evaluate(proposal('stripe.refund', 100, { amount_cents: 9_000 }), BUDGET);
    expect(decision.decidedBy).toBe('cost-understated');
    expect(decision.reasons.join(' ')).toContain('$90.00');
  });

  it('checks the budget against the real amount, so an understated refund cannot sneak past the cap', () => {
    const nearlySpent: Budget = { spentCents: 45_000, limitCents: 50_000 };
    const decision = evaluate(proposal('stripe.refund', 100, { amount_cents: 9_000 }), nearlySpent);
    expect(decision.verdict).toBe('DENY');
    expect(decision.decidedBy).toBe('budget-exceeded');
  });

  it('charges the larger of the two against the budget', () => {
    expect(evaluate(proposal('stripe.refund', 100, { amount_cents: 9_000 }), BUDGET).costCents).toBe(9_000);
    expect(evaluate(proposal('stripe.refund', 9_000, { amount_cents: 100 }), BUDGET).costCents).toBe(9_000);
  });

  it.each([
    ['negative', -5],
    ['fractional', 12.5],
    ['NaN', Number.NaN],
  ])('refuses a %s amount in the arguments', (_label, amount) => {
    const decision = evaluate(proposal('stripe.refund', 100, { amount_cents: amount }), BUDGET);
    expect(decision.verdict).toBe('DENY');
    expect(decision.decidedBy).toBe('malformed-cost');
  });

  it('changes nothing when the estimate and the arguments agree', () => {
    const decision = evaluate(proposal('stripe.refund', 8_400, { amount_cents: 8_400 }), BUDGET);
    expect(decision.verdict).toBe('REQUIRE_APPROVAL');
    expect(decision.decidedBy).toBe('money-movement');
    expect(decision.costCents).toBe(8_400);
  });

  it('changes nothing when there is no amount in the arguments', () => {
    const decision = evaluate(proposal('crm.read', 0, { customer: 'acme' }), BUDGET);
    expect(decision.verdict).toBe('ALLOW');
    expect(decision.costCents).toBe(0);
  });
});
