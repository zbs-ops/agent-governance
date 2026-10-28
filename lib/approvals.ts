import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { ActionProposal } from './types';

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
 * so an agent can't obtain a token for a name it doesn't have the key for.
 *
 * The token is bound to the reviewer and to WHAT is being approved: the id, agent, tool,
 * arguments, estimate and request time. Binding to the id alone wasn't enough, because ids
 * are a counter that restarts on every reset, so a token for one act_0001 used to approve
 * any later act_0001.
 */
export function mintApprovalToken(proposal: ActionProposal, reviewer: string): string {
  const key = REVIEWER_KEYS[normalize(reviewer)];
  if (key === undefined) {
    throw new Error(`"${reviewer}" is not a registered reviewer.`);
  }
  return sign(proposal, normalize(reviewer), key);
}

/** True only if `token` was minted by the key holder for this reviewer and this exact proposal. */
export function verifyApprovalToken(
  proposal: ActionProposal,
  reviewer: string,
  token: string | undefined,
): boolean {
  if (token === undefined) return false;
  const key = REVIEWER_KEYS[normalize(reviewer)];
  if (key === undefined) return false;
  const expected = sign(proposal, normalize(reviewer), key);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  // timingSafeEqual needs equal-length buffers, and a length mismatch is already a no-match.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** JSON with object keys sorted at every level, so the same proposal always hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A fingerprint of everything an approval is an approval OF. */
export function proposalDigest(p: ActionProposal): string {
  const { id, agent, tool, args, estimatedCostCents, createdAt } = p;
  return createHash('sha256').update(canonical({ id, agent, tool, args, estimatedCostCents, createdAt })).digest('hex');
}

function sign(proposal: ActionProposal, reviewer: string, key: string): string {
  return createHmac('sha256', key).update(`${proposal.id}:${proposalDigest(proposal)}:${reviewer}`).digest('hex');
}
