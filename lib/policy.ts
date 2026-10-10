import type { ActionProposal, Budget, PolicyDecision, RiskTier } from './types';

/**
 * The gate.
 *
 * Policy is data, not branching code buried in a service. Each rule is a row you
 * can read, reorder, or ship from a database later without touching this file.
 *
 * Two properties matter more than the rules themselves:
 *   1. It is deterministic. The same proposal always produces the same verdict.
 *   2. It fails closed. An unknown tool is not "probably fine".
 */

export interface PolicyRule {
  id: string;
  /** Human-readable, because this text ends up in the audit log. */
  describe: string;
  tier: RiskTier;
  /** Tools this rule governs. `*` suffix matches a namespace. */
  match: string[];
}

/**
 * Tiers, in plain terms:
 *   1 — reading things. Let the agent get on with it.
 *   2 — writing to internal systems. Allowed, but recorded loudly.
 *   3 — money, customers, production, deletion. A human says yes first.
 */
export const POLICY: PolicyRule[] = [
  {
    id: 'read-only',
    describe: 'Read-only lookups cannot change anything, so they run unattended.',
    tier: 1,
    match: ['crm.read', 'db.query', 'search.*', 'calendar.read'],
  },
  {
    id: 'internal-write',
    describe: 'Writes to internal records are reversible and stay inside the company.',
    tier: 2,
    match: ['crm.update', 'ticket.create', 'notify.internal', 'db.insert'],
  },
  {
    id: 'money-movement',
    describe: 'Anything that moves money needs a person to sign off.',
    tier: 3,
    match: ['stripe.*', 'payout.*', 'invoice.void', 'refund.*'],
  },
  {
    id: 'customer-contact',
    describe: 'A message to a customer cannot be unsent.',
    tier: 3,
    match: ['email.send', 'sms.send', 'whatsapp.send'],
  },
  {
    id: 'destructive',
    describe: 'Deletes and production deploys need a person to sign off.',
    tier: 3,
    match: ['db.delete', 'db.drop', 'deploy.production', 's3.delete'],
  },
];

function matches(pattern: string, tool: string): boolean {
  if (pattern.endsWith('*')) return tool.startsWith(pattern.slice(0, -1));
  return pattern === tool;
}

function ruleFor(tool: string): PolicyRule | undefined {
  return POLICY.find((rule) => rule.match.some((pattern) => matches(pattern, tool)));
}

/** Hard stops that override the tier entirely. Order matters and is asserted in tests. */
export function evaluate(proposal: ActionProposal, budget: Budget): PolicyDecision {
  const reasons: string[] = [];

  // 1. Unknown tools fail closed. An agent that invents a tool name is either
  //    hallucinating or probing, and neither deserves the benefit of the doubt.
  const rule = ruleFor(proposal.tool);
  if (!rule) {
    return {
      verdict: 'DENY',
      tier: 3,
      reasons: [`"${proposal.tool}" is not a tool this agent is allowed to call.`],
      decidedBy: 'unknown-tool',
    };
  }
  reasons.push(rule.describe);

  // 2. The estimate has to be a number the budget math can trust. A negative cost
  //    passes the cap and then hands budget back when it runs, and NaN passes every
  //    check below, because every comparison with NaN is false.
  const cost = proposal.estimatedCostCents;
  if (!Number.isSafeInteger(cost) || cost < 0) {
    reasons.push(`An estimated cost of ${String(cost)} cents is not a whole, non-negative amount.`);
    return { verdict: 'DENY', tier: rule.tier, reasons, decidedBy: 'malformed-cost' };
  }

  // 3. Budget is checked before anything else is weighed, because a runaway
  //    agent is the failure that costs real money while everyone is asleep.
  const projected = budget.spentCents + proposal.estimatedCostCents;
  if (projected > budget.limitCents) {
    reasons.push(
      `This would put spend at ${money(projected)} against a ${money(budget.limitCents)} cap.`,
    );
    return { verdict: 'DENY', tier: rule.tier, reasons, decidedBy: 'budget-exceeded' };
  }

  // 4. A single action asking for more than a quarter of the whole budget is
  //    suspicious even when it fits. Agents do not usually need that much at once.
  if (proposal.estimatedCostCents > budget.limitCents / 4) {
    reasons.push(
      `${money(proposal.estimatedCostCents)} in one action is unusually large — escalated for review.`,
    );
    return { verdict: 'REQUIRE_APPROVAL', tier: 3, reasons, decidedBy: 'large-single-spend' };
  }

  if (rule.tier === 3) {
    reasons.push('Tier 3 always waits for a human.');
    return { verdict: 'REQUIRE_APPROVAL', tier: 3, reasons, decidedBy: rule.id };
  }

  if (rule.tier === 2) {
    reasons.push('Tier 2 runs unattended but is recorded in full.');
    return { verdict: 'ALLOW', tier: 2, reasons, decidedBy: rule.id };
  }

  return { verdict: 'ALLOW', tier: 1, reasons, decidedBy: rule.id };
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
