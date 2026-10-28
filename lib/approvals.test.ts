import { describe, expect, it } from 'vitest';

import { isRegisteredReviewer, mintApprovalToken, verifyApprovalToken } from './approvals';
import type { ActionProposal } from './types';

const proposal = (id: string): ActionProposal => ({
  id,
  agent: 'billing-agent',
  tool: 'stripe.refund',
  args: { amount_cents: 500 },
  estimatedCostCents: 500,
  createdAt: '2026-10-28T05:00:00.000Z',
});

describe('approval tokens', () => {
  it('verifies a token it just minted', () => {
    const t = mintApprovalToken(proposal('act_0001'), 'you@company.com');
    expect(verifyApprovalToken(proposal('act_0001'), 'you@company.com', t)).toBe(true);
  });

  it('is bound to the proposal, so a token for one action does not approve another', () => {
    const t = mintApprovalToken(proposal('act_0001'), 'you@company.com');
    expect(verifyApprovalToken(proposal('act_0002'), 'you@company.com', t)).toBe(false);
  });

  it('is bound to the reviewer', () => {
    const t = mintApprovalToken(proposal('act_0001'), 'you@company.com');
    expect(verifyApprovalToken(proposal('act_0001'), 'someone-else', t)).toBe(false);
  });

  it('matches the reviewer regardless of case or surrounding space', () => {
    const t = mintApprovalToken(proposal('act_0001'), 'you@company.com');
    expect(verifyApprovalToken(proposal('act_0001'), '  YOU@company.com ', t)).toBe(true);
  });

  it('rejects a missing or empty token', () => {
    expect(verifyApprovalToken(proposal('act_0001'), 'you@company.com', undefined)).toBe(false);
    expect(verifyApprovalToken(proposal('act_0001'), 'you@company.com', '')).toBe(false);
  });

  it('cannot mint for an unregistered reviewer', () => {
    expect(() => mintApprovalToken(proposal('act_0001'), 'rogue-agent')).toThrow();
    expect(isRegisteredReviewer('rogue-agent')).toBe(false);
    expect(isRegisteredReviewer('you@company.com')).toBe(true);
  });
});
