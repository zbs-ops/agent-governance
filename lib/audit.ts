import { createHash } from 'node:crypto';

import type { AuditEntry, ChainVerification } from './types';

/**
 * A tamper-evident audit log.
 *
 * Every entry carries the hash of the entry before it, so the log is a chain.
 * Change one field in one historical entry and its hash no longer matches, and
 * every entry after it is orphaned. You cannot quietly rewrite history — you can
 * only append to it.
 *
 * This is the difference between "we have logs" and "we can prove what happened".
 */

export const GENESIS = 'GENESIS';

/** The bytes that get hashed. Field order is fixed — change it and every
 *  previously written chain stops verifying, which is the point. */
function canonical(entry: Omit<AuditEntry, 'hash'>): string {
  return JSON.stringify([
    entry.seq,
    entry.at,
    entry.event,
    entry.actor,
    entry.proposalId,
    entry.detail,
    entry.prevHash,
  ]);
}

export function hashEntry(entry: Omit<AuditEntry, 'hash'>): string {
  return createHash('sha256').update(canonical(entry)).digest('hex');
}

export function appendEntry(
  chain: AuditEntry[],
  input: Omit<AuditEntry, 'seq' | 'hash' | 'prevHash'>,
): AuditEntry {
  const previous = chain[chain.length - 1];
  const unsealed = {
    ...input,
    seq: chain.length + 1,
    prevHash: previous ? previous.hash : GENESIS,
  };
  const entry: AuditEntry = { ...unsealed, hash: hashEntry(unsealed) };
  chain.push(entry);
  return entry;
}

/**
 * Walks the chain and recomputes every hash.
 *
 * Returns the first sequence number that does not add up, which is what makes
 * the check useful: it tells you *where* the tampering starts, not just that
 * something is wrong.
 */
export function verifyChain(chain: AuditEntry[]): ChainVerification {
  let expectedPrev = GENESIS;

  for (const entry of chain) {
    if (entry.prevHash !== expectedPrev) {
      return {
        valid: false,
        length: chain.length,
        brokenAt: entry.seq,
        message: `Entry #${entry.seq} points at the wrong parent. The chain was cut or reordered here.`,
      };
    }

    const recomputed = hashEntry({
      seq: entry.seq,
      at: entry.at,
      event: entry.event,
      actor: entry.actor,
      proposalId: entry.proposalId,
      detail: entry.detail,
      prevHash: entry.prevHash,
    });

    if (recomputed !== entry.hash) {
      return {
        valid: false,
        length: chain.length,
        brokenAt: entry.seq,
        message: `Entry #${entry.seq} was edited after it was written. Its contents no longer match its hash.`,
      };
    }

    expectedPrev = entry.hash;
  }

  return {
    valid: true,
    length: chain.length,
    brokenAt: null,
    message:
      chain.length === 0
        ? 'Empty ledger.'
        : `All ${chain.length} entries verify against their hashes.`,
  };
}
