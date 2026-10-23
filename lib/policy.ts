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

/** Lowercase ASCII segments joined by dots, at least two of them: `stripe.refund`. */
const TOOL_NAME = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

function matches(pattern: string, tool: string): boolean {
  if (pattern.endsWith('*')) return tool.startsWith(pattern.slice(0, -1));
  return pattern === tool;
}

function ruleFor(tool: string): PolicyRule | undefined {
  return POLICY.find((rule) => rule.match.some((pattern) => matches(pattern, tool)));
}

/**
 * How many tier-2 writes one agent may run unattended inside the window before the next one
 * waits for a person. A single write is routine; a loop creating hundreds of tickets is a
 * runaway agent, and it's cheaper to pause it once than to clean up after it.
 */
export const UNATTENDED_WRITE_LIMIT = 10;
export const UNATTENDED_WINDOW_MS = 60_000;

/**
 * How long a person's yes stays valid after an action was asked for. A refund approved days
 * later, after the customer, the order and the reason have moved on, is approving a different
 * situation from the one the agent described. Past this, the request has to be made again.
 */
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/** What the gate knows about recent history. The store supplies it; the gate stays pure. */
export interface History {
  /** Tier-2 writes this agent has run unattended within the current window. */
  recentUnattendedWrites?: number;
}

/** Hard stops that override the tier entirely. Order matters and is asserted in tests. */
export function evaluate(proposal: ActionProposal, budget: Budget, history: History = {}): PolicyDecision {
  const reasons: string[] = [];

  // 0. A tool name has to look like a tool name before it is matched against anything.
  //    Wildcards match by prefix, so without this "search.x/../stripe.refund" or a
  //    newline-smuggled second tool would ride `search.*` straight through as a read,
  //    and a lookalike letter would put a fake refund in front of a human approver.
  if (!TOOL_NAME.test(proposal.tool)) {
    return {
      verdict: 'DENY',
      tier: 3,
      reasons: [`${JSON.stringify(proposal.tool)} is not a well-formed tool name.`],
      decidedBy: 'malformed-tool',
      costCents: 0,
    };
  }

  // 1. Unknown tools fail closed. An agent that invents a tool name is either
  //    hallucinating or probing, and neither deserves the benefit of the doubt.
  const rule = ruleFor(proposal.tool);
  if (!rule) {
    return {
      verdict: 'DENY',
      tier: 3,
      reasons: [`"${proposal.tool}" is not a tool this agent is allowed to call.`],
      decidedBy: 'unknown-tool',
      costCents: 0,
    };
  }
  reasons.push(rule.describe);

  // 2. Both numbers have to be ones the budget math can trust: the agent's estimate,
  //    and the amount the arguments will actually move, if they name one. A negative
  //    cost passes the cap and then hands budget back when it runs, and NaN passes
  //    every check below, because every comparison with NaN is false.
  const estimate = proposal.estimatedCostCents;
  if (!isCents(estimate)) {
    reasons.push(`An estimated cost of ${String(estimate)} cents is not a whole, non-negative amount.`);
    return { verdict: 'DENY', tier: rule.tier, reasons, decidedBy: 'malformed-cost', costCents: 0 };
  }
  const argAmount = proposal.args.amount_cents;
  if (argAmount !== undefined && !isCents(argAmount)) {
    reasons.push(`The arguments ask to move ${String(argAmount)} cents, which is not a whole, non-negative amount.`);
    return { verdict: 'DENY', tier: rule.tier, reasons, decidedBy: 'malformed-cost', costCents: 0 };
  }

  // The estimate is the agent's word; amount_cents is what the call will do. Charge
  // whichever is larger, so understating the estimate can't buy room under the cap.
  const cost = Math.max(estimate, typeof argAmount === 'number' ? argAmount : 0);
  const understated = cost > estimate;

  // 3. Budget is checked before anything else is weighed, because a runaway
  //    agent is the failure that costs real money while everyone is asleep.
  const projected = budget.spentCents + cost;
  if (projected > budget.limitCents) {
    reasons.push(
      `This would put spend at ${money(projected)} against a ${money(budget.limitCents)} cap.`,
    );
    return { verdict: 'DENY', tier: rule.tier, reasons, decidedBy: 'budget-exceeded', costCents: cost };
  }

  // 4. An agent that says one number and asks to move a bigger one has told the gate
  //    two different things. That is worth a human's eyes even on a tool that would
  //    normally run unattended, and the human should see the real amount.
  if (understated) {
    reasons.push(
      `The agent estimated ${money(estimate)}, but the arguments move ${money(cost)} — escalated for review.`,
    );
    return { verdict: 'REQUIRE_APPROVAL', tier: 3, reasons, decidedBy: 'cost-understated', costCents: cost };
  }

  // 5. A single action asking for more than a quarter of the whole budget is
  //    suspicious even when it fits. Agents do not usually need that much at once.
  if (cost > budget.limitCents / 4) {
    reasons.push(`${money(cost)} in one action is unusually large — escalated for review.`);
    return { verdict: 'REQUIRE_APPROVAL', tier: 3, reasons, decidedBy: 'large-single-spend', costCents: cost };
  }

  if (rule.tier === 3) {
    reasons.push('Tier 3 always waits for a human.');
    return { verdict: 'REQUIRE_APPROVAL', tier: 3, reasons, decidedBy: rule.id, costCents: cost };
  }

  if (rule.tier === 2) {
    // A runaway loop of individually harmless writes is still a runaway. Reads are never
    // slowed down, because they can't change anything.
    const recent = history.recentUnattendedWrites ?? 0;
    if (recent >= UNATTENDED_WRITE_LIMIT) {
      reasons.push(
        `This agent has already run ${recent} unattended writes in the last ${UNATTENDED_WINDOW_MS / 1000}s (limit ${UNATTENDED_WRITE_LIMIT}), so the next one waits for a person.`,
      );
      return { verdict: 'REQUIRE_APPROVAL', tier: 2, reasons, decidedBy: 'unattended-rate', costCents: cost };
    }
    reasons.push('Tier 2 runs unattended but is recorded in full.');
    return { verdict: 'ALLOW', tier: 2, reasons, decidedBy: rule.id, costCents: cost };
  }

  return { verdict: 'ALLOW', tier: 1, reasons, decidedBy: rule.id, costCents: cost };
}

/** A whole, non-negative number of cents that the budget arithmetic can trust. */
function isCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
