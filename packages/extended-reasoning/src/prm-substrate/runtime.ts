import type { ScoreStepWithPrmInput, StepScore } from './types.js';

/**
 * Score a single step at runtime.
 *
 * Drop-in contract:
 *   - If `loader` returns null → `{ kind: 'unscored', reason: 'no-model-loaded' }`.
 *     No log noise, no fallback heuristic — the calling agent treats this as
 *     "scoring disabled" and proceeds.
 *   - If `loader` returns a model → score in [0, 1]. If the score is below
 *     `warnBelow`, the optional `onLowScore` is called.
 *
 * Determinism: tests stub `loader` to a fixed model handle and inspect the
 * returned `StepScore`. No env reads happen here — env handling lives in
 * the caller, who builds a `PrmLoader` closure.
 */
export async function scoreStepWithPRM(
  input: ScoreStepWithPrmInput,
): Promise<StepScore> {
  const model = await input.loader();
  if (model === null) {
    return { kind: 'unscored', reason: 'no-model-loaded' };
  }
  const value = await model.score(input.step, input.contextSteps ?? []);
  const clamped = Math.max(0, Math.min(1, value));
  const threshold = input.warnBelow ?? 0.4;
  if (threshold > 0 && clamped < threshold && input.onLowScore !== undefined) {
    input.onLowScore(clamped, input.step);
  }
  return { kind: 'scored', value: clamped, modelId: model.modelId };
}
