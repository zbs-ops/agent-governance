import { evaluate } from '../lib/policy';
import type { PolicyDecision } from '../lib/types';
import { DEFAULT_BUDGET, SCENARIOS, type Category, type Scenario } from './scenarios';

export interface Result {
  scenario: Scenario;
  decision: PolicyDecision;
  passed: boolean;
}

export function runScenario(scenario: Scenario): Result {
  const decision = evaluate(
    {
      id: `eval_${scenario.id}`,
      agent: 'eval-harness',
      tool: scenario.tool,
      args: scenario.args ?? {},
      estimatedCostCents: scenario.costCents,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    scenario.budget ?? DEFAULT_BUDGET,
  );
  const passed =
    decision.verdict === scenario.expect &&
    (scenario.expectDecidedBy === undefined || decision.decidedBy === scenario.expectDecidedBy);
  return { scenario, decision, passed };
}

export function runAll(): Result[] {
  return SCENARIOS.map(runScenario);
}

/** A plain-text scorecard: one line per category, then every failure spelled out. */
export function scorecard(results: Result[]): string {
  const byCategory = new Map<Category, Result[]>();
  for (const r of results) {
    byCategory.set(r.scenario.category, [...(byCategory.get(r.scenario.category) ?? []), r]);
  }
  const lines = ['Gate eval scorecard', ''];
  for (const [category, rs] of byCategory) {
    const passed = rs.filter((r) => r.passed).length;
    lines.push(`${category.padEnd(18)} ${passed}/${rs.length}`);
  }
  const total = results.filter((r) => r.passed).length;
  lines.push('', `${'total'.padEnd(18)} ${total}/${results.length}`);
  for (const r of results.filter((x) => !x.passed)) {
    lines.push(
      `FAIL ${r.scenario.id} ${r.scenario.intent}: wanted ${r.scenario.expect}` +
        `${r.scenario.expectDecidedBy ? ` (${r.scenario.expectDecidedBy})` : ''}, ` +
        `got ${r.decision.verdict} (${r.decision.decidedBy})`,
    );
  }
  return lines.join('\n');
}
