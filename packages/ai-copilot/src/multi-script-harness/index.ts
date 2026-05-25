/**
 * Multi-script harness public surface.
 *
 * Exposes:
 *   - types (TestCase, Rubric, Result, Report)
 *   - baseline fixtures
 *   - heuristic judge (CI-safe default)
 *   - audit runner with bounded concurrency
 */

export * from './types.js';
export {
  BASELINE_TEST_CASES,
  EVEN_WEIGHTED,
  LEGAL_WEIGHTED,
  CHAT_WEIGHTED,
} from './fixtures.js';
export { heuristicJudge, scoreRubric } from './heuristic-judge.js';
export {
  runMultiScriptAudit,
  failingLocales,
  type RunAuditOptions,
} from './audit-runner.js';
