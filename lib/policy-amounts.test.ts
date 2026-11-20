import { describe, expect, it } from 'vitest';

import { mintApprovalToken } from './approvals';
import { evaluate } from './policy';
import { resetStore } from './store';
import type { ActionProposal, Budget } from './types';

/**
 * The gate priced a call by the larger of the agent's estimate and `amount_cents`. An amount written
 * any other way was invisible: a $300 refund with an estimate of $0 and `amountCents`, `cents`,
 * `amount_in_cents`, `amount: 300`, `amount_usd`, `total`, `value`, a nested `{ amount: { value } }`,
 * `{ refund: { amount_cents } }` or line items ran on one approval, cost nothing against the budget
 * and skipped the two-person rule (13 forms, probed against lib/store).
 *
 * Now every field whose name says cents (its last word is "cents": `amount_cents`, `amountCents`,
 * `amount_in_cents`, `total_cents`, `cents`) counts, anywhere in the arguments, and a list of line
 * items counts as their sum; the call is charged the largest of these and the estimate. An amount
 * with no unit (`amount`, `amount_usd`, `total`, `value`, `price`, `sum`, `subtotal`) on a tool that
 * moves money is refused: `amount: 300` is $3.00 to Stripe and $300 to others, and guessing wrong
 * would misprice it a hundredfold.
 */

const BUDGET: Budget = { spentCents: 0, limitCents: 50_000 };

function proposal(tool: string, estimatedCostCents: number, args: Record<string, unknown>): ActionProposal {
  return { id: 'act_test', agent: 'test-agent', tool, args, estimatedCostCents, createdAt: '2026-01-01T00:00:00.000Z' };
}

describe('amounts written in cents under another name', () => {
  it.each([
    ['amountCents', { amountCents: 30_000 }],
    ['AMOUNT_CENTS', { AMOUNT_CENTS: 30_000 }],
    ['amount_in_cents', { amount_in_cents: 30_000 }],
    ['cents', { cents: 30_000 }],
    ['total_cents', { total_cents: 30_000 }],
    ['nested money', { money: { amount_cents: 30_000 } }],
    ['nested refund', { refund: { amountCents: 30_000 } }],
    ['line items', { items: [{ amount_cents: 20_000 }, { amount_cents: 10_000 }] }],
  ])('%s is charged', (_label, args) => {
    const decision = evaluate(proposal('refund.issue', 0, { invoice: 'R4-1', ...args }), BUDGET);
    expect(decision.costCents).toBe(30_000);
    expect(decision.decidedBy).toBe('cost-understated');
  });

  it('a split refund priced under another name needs a second person', () => {
    const store = resetStore();
    const p = store.propose({ agent: 'billing-agent', tool: 'refund.issue', args: { invoice: 'R4-1', amountCents: 30_000 }, estimatedCostCents: 0 });
    const after = store.decide(p.proposal.id, true, 'you@company.com', 'ok', mintApprovalToken(p.proposal, 'you@company.com'));
    expect(after?.state).toBe('PENDING_APPROVAL');
    expect(after?.approvals).toEqual(['you@company.com']);
  });

  it('an amount over the cap under another name is refused', () => {
    const decision = evaluate(proposal('refund.issue', 0, { cents: 60_000 }), BUDGET);
    expect(decision.verdict).toBe('DENY');
    expect(decision.decidedBy).toBe('budget-exceeded');
  });

  it.each([
    ['a negative amount', { amountCents: -500 }],
    ['a fraction of a cent', { money: { amount_cents: 1.5 } }],
    ['a string', { cents: '30000' }],
  ])('%s under another name is refused as malformed', (_label, args) => {
    const decision = evaluate(proposal('refund.issue', 0, args), BUDGET);
    expect(decision.verdict).toBe('DENY');
    expect(decision.decidedBy).toBe('malformed-cost');
  });

  it('line items and a total that agree are not counted twice', () => {
    const decision = evaluate(
      proposal('refund.issue', 0, { amount_cents: 30_000, items: [{ amount_cents: 20_000 }, { amount_cents: 10_000 }] }),
      BUDGET,
    );
    expect(decision.costCents).toBe(30_000);
  });
});

describe('names written as one word', () => {
  // #20 split names into words, so `amountcents` (one word, not "cents") was neither priced nor
  // refused: charged $0, like the forms #20 closed. A word that ends in cents is priced; a word that
  // contains amount, total or price, or is value or sum, is an amount.
  it.each(['amountcents', 'totalcents', 'amountincents', 'AMOUNTCENTS'])('%s is charged', (key) => {
    const decision = evaluate(proposal('refund.issue', 0, { [key]: 30_000 }), BUDGET);
    expect(decision.costCents).toBe(30_000);
    expect(decision.decidedBy).toBe('cost-understated');
  });

  it.each(['amountusd', 'totalamount', 'unitprice', 'refundamount', 'grandtotal'])('%s is refused', (key) => {
    const decision = evaluate(proposal('refund.issue', 0, { [key]: 300 }), BUDGET);
    expect(decision.decidedBy).toBe('unpriced-amount');
  });

  it.each(['consumer', 'summary', 'count', 'valueset'])('%s is not an amount', (key) => {
    expect(evaluate(proposal('refund.issue', 0, { [key]: 123 }), BUDGET).decidedBy).toBe('money-movement');
  });
});

describe('amounts with no unit on a tool that moves money', () => {
  it.each([
    ['amount', { amount: 300 }],
    ['amount_usd', { amount_usd: 300 }],
    ['total', { total: 300 }],
    ['value', { value: 300 }],
    ['price', { price: '300.00' }],
    ['subtotal', { subtotal: 300 }],
    ['nested amount', { amount: { value: 30_000, currency: 'usd' } }],
    ['next to amount_cents', { amount_cents: 100, amount: 300 }],
  ])('%s is refused', (_label, args) => {
    const decision = evaluate(proposal('refund.issue', 0, { invoice: 'R4-1', ...args }), BUDGET);
    expect(decision.verdict).toBe('DENY');
    expect(decision.decidedBy).toBe('unpriced-amount');
    expect(decision.reasons.join(' ')).toContain('cents');
  });

  it.each([
    ['a read', 'crm.read', { total: 3 }],
    ['an internal write', 'crm.update', { value: 7 }],
    ['a money tool with a text value', 'refund.issue', { metadata: { value: 'vip' }, amount_cents: 500 }],
    ['a money tool with no amount at all', 'refund.issue', { invoice: 'R4-1' }],
  ])('%s is unchanged', (_label, tool, args) => {
    expect(evaluate(proposal(tool, 0, args), BUDGET).decidedBy).not.toBe('unpriced-amount');
  });
});
