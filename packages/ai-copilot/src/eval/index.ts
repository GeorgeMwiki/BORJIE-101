/**
 * Eval harness — golden scenarios + runner.
 *
 * NOT a vitest test. Callers that want CI integration wrap
 * `runScenarios(GOLDEN_SCENARIOS, ...)` in a vitest test and assert
 * `report.failed === 0`.
 */

export * from './scenario.js';
export * from './golden-scenarios.js';
export * from './scenarios-extended.js';
export * from './runner.js';
export * from './hallucination-guard.js';

import { GOLDEN_SCENARIOS } from './golden-scenarios.js';
import { EXTENDED_SCENARIOS } from './scenarios-extended.js';
import type { Scenario } from './scenario.js';

/**
 * Full eval set — GOLDEN + EXTENDED. ~100 scenarios covering routing,
 * tool dispatch, advisor gating, visibility, handoff, and governance.
 */
export const ALL_SCENARIOS: Scenario[] = [
  ...GOLDEN_SCENARIOS,
  ...EXTENDED_SCENARIOS,
];
