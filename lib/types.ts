/** What an agent wants to do, before it is allowed to do it. */
export interface ActionProposal {
  id: string;
  agent: string;
  /** The tool the agent is asking to call, e.g. "stripe.refund". */
  tool: string;
  /** Free-form arguments the agent supplied. */
  args: Record<string, unknown>;
  /** Estimated spend, in cents. Agents lie; the gate checks anyway. */
  estimatedCostCents: number;
  createdAt: string;
}

export type RiskTier = 1 | 2 | 3;

export type Verdict = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';

export interface PolicyDecision {
  verdict: Verdict;
  tier: RiskTier;
  /** Every rule that fired, in the order it fired. */
  reasons: string[];
  /** The rule that produced the final verdict. */
  decidedBy: string;
}

export type ProposalState =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'AUTO_ALLOWED'
  | 'BLOCKED'
  | 'EXECUTED';

export interface GatedAction {
  proposal: ActionProposal;
  decision: PolicyDecision;
  state: ProposalState;
  /** Who approved or rejected it, if a human did. */
  reviewedBy?: string;
  reviewNote?: string;
}

/** One immutable line in the ledger. */
export interface AuditEntry {
  seq: number;
  at: string;
  event:
    | 'PROPOSED'
    | 'POLICY_EVALUATED'
    | 'APPROVED'
    | 'REJECTED'
    | 'EXECUTED'
    | 'BLOCKED';
  actor: string;
  proposalId: string;
  detail: Record<string, unknown>;
  /** Hash of the previous entry. The first entry chains to GENESIS. */
  prevHash: string;
  /** SHA-256 over every field above. */
  hash: string;
}

export interface ChainVerification {
  valid: boolean;
  length: number;
  /** The first sequence number where the chain stops adding up. */
  brokenAt: number | null;
  message: string;
}

export interface Budget {
  spentCents: number;
  limitCents: number;
}
