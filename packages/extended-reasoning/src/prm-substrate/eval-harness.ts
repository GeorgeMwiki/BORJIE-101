import type {
  CalibrationBucket,
  PrmEvalFixture,
  PrmEvalResult,
  PrmModel,
} from './types.js';

/**
 * Run a PRM checkpoint against an eval fixture set. The fixtures carry
 * human-labelled step quality (`humanLabel ∈ [0, 1]`); we run the model on
 * each, compute mean absolute error, accuracy at the 0.5 cutoff, and a
 * 10-bucket calibration curve.
 */
export async function runPrmEval(
  model: PrmModel,
  fixtures: ReadonlyArray<PrmEvalFixture>,
): Promise<PrmEvalResult> {
  if (fixtures.length === 0) {
    throw new Error('[PRM] runPrmEval requires at least one fixture');
  }

  const scores: number[] = [];
  let absErrSum = 0;
  let correctAt0p5 = 0;
  const buckets: { count: number; humanSum: number }[] = Array.from(
    { length: 10 },
    () => ({ count: 0, humanSum: 0 }),
  );

  for (const fx of fixtures) {
    const raw = await model.score(fx.step, fx.contextSteps);
    const s = Math.max(0, Math.min(1, raw));
    scores.push(s);
    absErrSum += Math.abs(s - fx.humanLabel);
    const predLabel = s >= 0.5;
    const truthLabel = fx.humanLabel >= 0.5;
    if (predLabel === truthLabel) correctAt0p5 += 1;
    // Calibration bucket: clamp 1.0 into the top bucket
    const bi = Math.min(9, Math.floor(s * 10));
    const b = buckets[bi];
    if (b !== undefined) {
      b.count += 1;
      b.humanSum += fx.humanLabel;
    }
  }

  const calibration: ReadonlyArray<CalibrationBucket> = buckets.map((b, i) => ({
    binCentre: i / 10 + 0.05,
    count: b.count,
    meanHumanLabel: b.count > 0 ? b.humanSum / b.count : 0,
  }));

  return {
    modelId: model.modelId,
    fixtures: fixtures.length,
    meanAbsoluteError: absErrSum / fixtures.length,
    accuracyAt0p5: correctAt0p5 / fixtures.length,
    calibration,
  };
}
