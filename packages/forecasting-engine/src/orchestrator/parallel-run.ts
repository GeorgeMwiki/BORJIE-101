/**
 * parallel-run — run N scenario configurations in parallel.
 *
 * Returns outcomes preserving input order. If any scenario throws,
 * the error is wrapped with the scenario name so the orchestrator
 * can decide whether to fail-fast or fail-soft.
 */

import type { AnyScenario, ScenarioRunContext } from '../scenarios/scenario.js';
import type { ScenarioOutcome } from '../types.js';
import { logger } from '../logger.js';

export interface ParallelInvocation {
  readonly scenario: AnyScenario;
  readonly input: unknown;
}

export async function runScenariosParallel(
  invocations: ReadonlyArray<ParallelInvocation>,
  ctx: ScenarioRunContext,
): Promise<ReadonlyArray<ScenarioOutcome>> {
  const promises = invocations.map(async (inv) => {
    try {
      const parsed = inv.scenario.inputs.parse(inv.input);
      return await inv.scenario.run(parsed, ctx);
    } catch (err) {
      logger.error('Scenario failed', { name: inv.scenario.name, err });
      throw new Error(
        `Scenario "${inv.scenario.name}" failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  });
  return Promise.all(promises);
}
