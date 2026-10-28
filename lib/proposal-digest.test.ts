import { describe, expect, it } from 'vitest';

import { proposalDigest } from './approvals';
import type { ActionProposal } from './types';

const base: ActionProposal = {
  id: 'act_0001',
  agent: 'billing-agent',
  tool: 'stripe.refund',
  args: { customer: 'acme', amount_cents: 500, meta: { reason: 'late', tags: ['a', 'b'] } },
  estimatedCostCents: 500,
  createdAt: '2026-10-28T05:00:00.000Z',
};

describe('proposalDigest', () => {
  it('is the same for the same proposal, whatever order its keys were written in', () => {
    const reordered: ActionProposal = {
      createdAt: base.createdAt,
      estimatedCostCents: 500,
      args: { meta: { tags: ['a', 'b'], reason: 'late' }, amount_cents: 500, customer: 'acme' },
      tool: 'stripe.refund',
      agent: 'billing-agent',
      id: 'act_0001',
    };
    expect(proposalDigest(reordered)).toBe(proposalDigest(base));
  });

  it('changes when anything that is being approved changes', () => {
    const d = proposalDigest(base);
    expect(proposalDigest({ ...base, args: { ...base.args, amount_cents: 501 } })).not.toBe(d);
    expect(proposalDigest({ ...base, args: { ...base.args, meta: { reason: 'late', tags: ['b', 'a'] } } })).not.toBe(d);
    expect(proposalDigest({ ...base, tool: 'stripe.payout' })).not.toBe(d);
    expect(proposalDigest({ ...base, createdAt: '2026-10-28T05:00:01.000Z' })).not.toBe(d);
  });

  it('tells a string "500" from the number 500', () => {
    expect(proposalDigest({ ...base, args: { ...base.args, amount_cents: '500' } })).not.toBe(proposalDigest(base));
  });
});
