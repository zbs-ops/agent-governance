import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { mintApprovalToken } from './approvals';
import { resetStore } from './store';

/**
 * Writes two ledgers in the exact shape GET /api/audit serves, one clean and one tampered, so
 * CI can check them with a different implementation: the Python `agentguard verify-ledger`
 * from PyPI. Skipped unless LEDGER_OUT is set.
 */

const out = process.env.LEDGER_OUT;
const REVIEWER = 'you@company.com';

describe.skipIf(!out)('ledger files for the cross-language check', () => {
  it('writes a clean and a tampered ledger', () => {
    const dir = out as string;
    mkdirSync(dir, { recursive: true });
    const store = resetStore();
    const refund = store.propose({
      agent: 'billing-agent',
      tool: 'refund.create',
      args: { customer: 'acme', amount_cents: 8_400 },
      estimatedCostCents: 8_400,
    });
    store.decide(refund.proposal.id, true, REVIEWER, 'ok', mintApprovalToken(refund.proposal, REVIEWER));
    expect(store.verify().valid).toBe(true);
    writeFileSync(join(dir, 'clean.json'), JSON.stringify({ entries: store.chain() }));

    store.tamper(3);
    expect(store.verify().brokenAt).toBe(3);
    writeFileSync(join(dir, 'tampered.json'), JSON.stringify({ entries: store.chain() }));
  });
});
