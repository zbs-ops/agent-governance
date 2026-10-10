import { describe, expect, it } from 'vitest';

import { runAll, runScenario, scorecard } from './run';
import { SCENARIOS } from './scenarios';

describe('adversarial eval: every scenario gets the safe answer', () => {
  it.each(SCENARIOS.map((s) => [`${s.id} ${s.intent}`, s] as const))('%s', (_name, scenario) => {
    const { decision, passed } = runScenario(scenario);
    expect(passed, `got ${decision.verdict} (${decision.decidedBy})`).toBe(true);
  });

  it('prints the scorecard', () => {
    const results = runAll();
    console.log(scorecard(results));
    expect(results.every((r) => r.passed)).toBe(true);
  });
});
