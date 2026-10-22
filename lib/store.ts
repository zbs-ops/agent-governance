import { appendEntry, verifyChain } from './audit';
import { verifyApprovalToken } from './approvals';
import { UNATTENDED_WINDOW_MS, evaluate, money } from './policy';
import type {
  ActionProposal,
  AuditEntry,
  Budget,
  ChainVerification,
  GatedAction,
} from './types';

/**
 * State lives in memory. That is a deliberate choice for a demo you can open
 * without provisioning anything — and it is the only part of this project that
 * is not production-shaped.
 *
 * Everything reaches it through the `Store` interface below, so swapping in
 * Postgres means writing one adapter and changing one line in `getStore()`.
 * Nothing above this file knows where the rows live.
 */

export interface Store {
  budget(): Budget;
  actions(): GatedAction[];
  chain(): AuditEntry[];
  propose(input: {
    agent: string;
    tool: string;
    args: Record<string, unknown>;
    estimatedCostCents: number;
  }): GatedAction;
  decide(
    id: string,
    approve: boolean,
    reviewer: string,
    note?: string,
    token?: string,
  ): GatedAction | undefined;
  verify(): ChainVerification;
  /** Demo only: corrupts one entry so the verifier has something to catch. */
  tamper(seq: number): boolean;
  reset(): void;
}

const BUDGET_LIMIT_CENTS = 50_000; // $500 per run.

/** Raised when the agent that proposed an action tries to approve it. */
export class SelfApprovalError extends Error {
  constructor(agent: string) {
    super(`"${agent}" proposed this action, so it can't also approve it.`);
    this.name = 'SelfApprovalError';
  }
}

/** Raised when an approval arrives without a valid token for the named reviewer. */
export class ApprovalAuthError extends Error {
  constructor(reviewer: string) {
    super(`"${reviewer}" did not present a valid approval token.`);
    this.name = 'ApprovalAuthError';
  }
}

/** Identity comparison that a stray capital or space can't get around. */
function sameActor(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

class MemoryStore implements Store {
  private budgetState: Budget = { spentCents: 0, limitCents: BUDGET_LIMIT_CENTS };

  private gated: GatedAction[] = [];

  private ledger: AuditEntry[] = [];

  private counter = 0;

  constructor() {
    // Seeded exactly once, here. Seeding from anywhere else risks running twice
    // against one store and inventing actions nobody proposed.
    seed(this);
  }

  budget(): Budget {
    return { ...this.budgetState };
  }

  actions(): GatedAction[] {
    return [...this.gated].reverse();
  }

  chain(): AuditEntry[] {
    return [...this.ledger];
  }

  propose(input: {
    agent: string;
    tool: string;
    args: Record<string, unknown>;
    estimatedCostCents: number;
  }): GatedAction {
    this.counter += 1;
    const proposal: ActionProposal = {
      id: `act_${String(this.counter).padStart(4, '0')}`,
      agent: input.agent,
      tool: input.tool,
      args: input.args,
      estimatedCostCents: input.estimatedCostCents,
      createdAt: new Date().toISOString(),
    };

    this.record('PROPOSED', proposal.agent, proposal.id, {
      tool: proposal.tool,
      estimated: money(proposal.estimatedCostCents),
    });

    const decision = evaluate(proposal, this.budgetState, {
      recentUnattendedWrites: this.recentUnattendedWrites(proposal.agent, Date.parse(proposal.createdAt)),
    });
    this.record('POLICY_EVALUATED', 'policy-engine', proposal.id, {
      verdict: decision.verdict,
      tier: decision.tier,
      decidedBy: decision.decidedBy,
    });

    let gated: GatedAction;
    if (decision.verdict === 'DENY') {
      gated = { proposal, decision, state: 'BLOCKED' };
      this.record('BLOCKED', 'policy-engine', proposal.id, { why: decision.reasons.at(-1) });
    } else if (decision.verdict === 'REQUIRE_APPROVAL') {
      gated = { proposal, decision, state: 'PENDING_APPROVAL' };
    } else {
      gated = { proposal, decision, state: 'AUTO_ALLOWED' };
      this.execute(gated);
    }

    this.gated.push(gated);
    return gated;
  }

  decide(
    id: string,
    approve: boolean,
    reviewer: string,
    note?: string,
    token?: string,
  ): GatedAction | undefined {
    const gated = this.gated.find((a) => a.proposal.id === id);
    if (!gated || gated.state !== 'PENDING_APPROVAL') return undefined;

    // Separation of duties: the agent that asked can't be the one who says yes. Checked
    // before anything is written, so a refused self-approval leaves no trace in state,
    // budget, or ledger. Withdrawing (rejecting) your own proposal is still fine.
    if (approve && sameActor(reviewer, gated.proposal.agent)) {
      throw new SelfApprovalError(gated.proposal.agent);
    }

    // Authenticate the approver. PR #4 kept an agent from approving as itself, but the
    // reviewer was still only a name: an agent could type a human's. An approval must now
    // carry a token only that reviewer's key can produce, bound to this proposal. Rejection
    // needs no token — withdrawing an action can't cause harm.
    if (approve && !verifyApprovalToken(id, reviewer, token)) {
      throw new ApprovalAuthError(reviewer);
    }

    gated.reviewedBy = reviewer;
    gated.reviewNote = note;

    if (!approve) {
      gated.state = 'REJECTED';
      this.record('REJECTED', reviewer, id, { note: note ?? null });
      return gated;
    }

    gated.state = 'APPROVED';
    this.record('APPROVED', reviewer, id, { note: note ?? null });

    // The cap was checked when this was proposed, but a tier-3 action can sit waiting while
    // other actions spend. Two refunds that each fit on their own could both be approved and
    // break the cap together. So check again at the moment the money would move. The
    // approval stays on the record (the person did say yes); the action just doesn't run.
    const projected = this.budgetState.spentCents + gated.decision.costCents;
    if (projected > this.budgetState.limitCents) {
      const why =
        `Budget changed while this waited: ${money(gated.decision.costCents)} would bring spend to ` +
        `${money(projected)}, over the ${money(this.budgetState.limitCents)} cap.`;
      gated.state = 'BLOCKED';
      gated.decision = {
        ...gated.decision,
        verdict: 'DENY',
        reasons: [...gated.decision.reasons, why],
        decidedBy: 'budget-exceeded-at-approval',
      };
      this.record('BLOCKED', 'policy-engine', id, { why });
      return gated;
    }

    this.execute(gated);
    return gated;
  }

  /** Tier-2 writes this agent ran without a human inside the rate-limit window. */
  private recentUnattendedWrites(agent: string, now: number): number {
    return this.gated.filter(
      (g) =>
        g.proposal.agent === agent &&
        g.decision.verdict === 'ALLOW' &&
        g.decision.tier === 2 &&
        now - Date.parse(g.proposal.createdAt) < UNATTENDED_WINDOW_MS,
    ).length;
  }

  verify(): ChainVerification {
    return verifyChain(this.ledger);
  }

  tamper(seq: number): boolean {
    const entry = this.ledger.find((e) => e.seq === seq);
    if (!entry) return false;
    // Rewrite history the way someone covering their tracks would: change the
    // content, leave the hash alone, hope nobody recomputes it.
    entry.detail = { ...entry.detail, tampered: 'this value was changed after the fact' };
    return true;
  }

  /** Replaced wholesale by `getStore().reset()`; see below. */
  reset(): void {
    this.budgetState = { spentCents: 0, limitCents: BUDGET_LIMIT_CENTS };
    this.gated = [];
    this.ledger = [];
    this.counter = 0;
  }

  /**
   * Spend is only counted when something actually runs, never when it is proposed, and it
   * is the gate's cost, not the agent's estimate, so an understated refund is charged in full.
   */
  private execute(gated: GatedAction): void {
    this.budgetState.spentCents += gated.decision.costCents;
    gated.state = 'EXECUTED';
    this.record('EXECUTED', 'runtime', gated.proposal.id, {
      tool: gated.proposal.tool,
      cost: money(gated.decision.costCents),
    });
  }

  private record(
    event: AuditEntry['event'],
    actor: string,
    proposalId: string,
    detail: Record<string, unknown>,
  ): void {
    appendEntry(this.ledger, { at: new Date().toISOString(), event, actor, proposalId, detail });
  }
}

/** A handful of realistic proposals so the page is never empty on first load. */
function seed(store: Store): void {
  store.propose({
    agent: 'support-agent',
    tool: 'crm.read',
    args: { customer: 'acme-industries' },
    estimatedCostCents: 0,
  });
  store.propose({
    agent: 'support-agent',
    tool: 'ticket.create',
    args: { subject: 'Duplicate charge on invoice 8842', priority: 'high' },
    estimatedCostCents: 0,
  });
  store.propose({
    agent: 'billing-agent',
    tool: 'refund.issue',
    args: { invoice: '8842', amount_cents: 12_400, reason: 'duplicate charge' },
    estimatedCostCents: 12_400,
  });
  store.propose({
    agent: 'growth-agent',
    tool: 'email.send',
    args: { to: '2,300 customers', template: 'winback-q3' },
    estimatedCostCents: 900,
  });
  store.propose({
    agent: 'rogue-agent',
    tool: 'db.drop',
    args: { table: 'customers' },
    estimatedCostCents: 0,
  });
  store.propose({
    agent: 'rogue-agent',
    tool: 'crypto.transfer',
    args: { to: '0xbeef…', amount: 'all' },
    estimatedCostCents: 0,
  });
}

/**
 * One store per server instance. Serverless functions are recycled, so a cold
 * start reseeds — which is exactly what you want from a demo anyone can open.
 */
declare global {
  // eslint-disable-next-line no-var
  var __agentGovernanceStore: Store | undefined;
}

export function getStore(): Store {
  if (!globalThis.__agentGovernanceStore) {
    globalThis.__agentGovernanceStore = new MemoryStore();
  }
  return globalThis.__agentGovernanceStore;
}

/** A clean slate is a new store, not a store that has been emptied and refilled. */
export function resetStore(): Store {
  globalThis.__agentGovernanceStore = new MemoryStore();
  return globalThis.__agentGovernanceStore;
}
