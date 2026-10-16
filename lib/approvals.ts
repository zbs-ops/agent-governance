import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Who is allowed to approve, and the secret that proves it.
 *
 * PR #4 stopped an agent approving *as itself*, but the reviewer was still just a string:
 * nothing stopped an agent from typing a human's name. An approval token closes that. A
 * reviewer can only produce a valid token for a proposal if they hold that reviewer's key,
 * so claiming someone else's name no longer claims their authority.
 *
 * Keys live in memory for the demo, exactly like the rest of the store. In a real system
 * they'd be per-user secrets behind an identity provider; the shape of the check is the same.
 */
const REVIEWER_KEYS: Record<string, string> = {
  'you@company.com': 'demo-human-reviewer-key',
};

/** Normalized so a stray capital or space can't change who a token is checked against. */
function normalize(reviewer: string): string {
  return reviewer.trim().toLowerCase();
}

export function isRegisteredReviewer(reviewer: string): boolean {
  return normalize(reviewer) in REVIEWER_KEYS;
}

/**
 * Mint an approval token for a reviewer who holds a key. Throws for an unknown reviewer,
 * so an agent can't obtain a token for a name it doesn't have the key for. The token binds
 * the reviewer to the specific proposal, so it can't be replayed onto a different action.
 */
export function mintApprovalToken(proposalId: string, reviewer: string): string {
  const key = REVIEWER_KEYS[normalize(reviewer)];
  if (key === undefined) {
    throw new Error(`"${reviewer}" is not a registered reviewer.`);
  }
  return sign(proposalId, normalize(reviewer), key);
}

/** True only if `token` was minted for this exact reviewer and proposal by the key holder. */
export function verifyApprovalToken(
  proposalId: string,
  reviewer: string,
  token: string | undefined,
): boolean {
  if (token === undefined) return false;
  const key = REVIEWER_KEYS[normalize(reviewer)];
  if (key === undefined) return false;
  const expected = sign(proposalId, normalize(reviewer), key);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  // timingSafeEqual needs equal-length buffers, and a length mismatch is already a no-match.
  return a.length === b.length && timingSafeEqual(a, b);
}

function sign(proposalId: string, reviewer: string, key: string): string {
  return createHmac('sha256', key).update(`${proposalId}:${reviewer}`).digest('hex');
}
