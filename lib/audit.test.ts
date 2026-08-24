import { describe, expect, it } from 'vitest';

import { GENESIS, appendEntry, hashEntry, verifyChain } from './audit';
import type { AuditEntry } from './types';

function chainOf(count: number): AuditEntry[] {
  const chain: AuditEntry[] = [];
  for (let i = 1; i <= count; i += 1) {
    appendEntry(chain, {
      at: `2026-01-0${i}T00:00:00.000Z`,
      event: 'PROPOSED',
      actor: 'agent',
      proposalId: `act_${i}`,
      detail: { n: i },
    });
  }
  return chain;
}

describe('the ledger', () => {
  it('starts at GENESIS and links each entry to the one before it', () => {
    const chain = chainOf(3);

    expect(chain[0]!.prevHash).toBe(GENESIS);
    expect(chain[1]!.prevHash).toBe(chain[0]!.hash);
    expect(chain[2]!.prevHash).toBe(chain[1]!.hash);
  });

  it('verifies a chain nobody has touched', () => {
    expect(verifyChain(chainOf(5))).toMatchObject({ valid: true, brokenAt: null, length: 5 });
  });

  it('treats an empty ledger as valid', () => {
    expect(verifyChain([]).valid).toBe(true);
  });
});

describe('what happens when someone edits history', () => {
  it('catches a changed value and names the entry', () => {
    const chain = chainOf(5);
    chain[2]!.detail = { n: 'quietly changed' };

    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(3);
  });

  it('catches a changed actor — the field you would forge to shift blame', () => {
    const chain = chainOf(4);
    chain[1]!.actor = 'someone-else';

    expect(verifyChain(chain).brokenAt).toBe(2);
  });

  it('catches a deleted entry, because the survivors no longer line up', () => {
    const chain = chainOf(5);
    chain.splice(2, 1);

    expect(verifyChain(chain).valid).toBe(false);
  });

  it('catches reordering', () => {
    const chain = chainOf(4);
    [chain[1], chain[2]] = [chain[2]!, chain[1]!];

    expect(verifyChain(chain).valid).toBe(false);
  });

  it('still fails when the hash is recomputed but the parent link is stale', () => {
    // The thorough forger: edit the entry AND fix its own hash. The chain still
    // breaks, because every later entry was built on the old hash.
    const chain = chainOf(4);
    const target = chain[1]!;
    target.detail = { n: 'rewritten' };
    target.hash = hashEntry({
      seq: target.seq,
      at: target.at,
      event: target.event,
      actor: target.actor,
      proposalId: target.proposalId,
      detail: target.detail,
      prevHash: target.prevHash,
    });

    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    // Entry 2 now verifies on its own, so the break surfaces at entry 3.
    expect(result.brokenAt).toBe(3);
  });
});
