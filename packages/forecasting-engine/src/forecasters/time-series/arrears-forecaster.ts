/**
 * ArrearsForecaster — logistic-growth fit to cumulative arrears.
 *
 * Cumulative arrears typically saturate (max ~ tenant rent × tenure).
 * Logistic curve: y(t) = K / (1 + exp(-r*(t - t0))). We fit (K, r, t0)
 * via grid + local refinement — no external optimisation library.
 *
 * H1 (audit): pre-fix, `forecastArrears` and `updateArrears` computed
 * `(t - t)/dayMs` which collapses to 0 — every projection used x=0 and
 * the residual was always `actual - logistic(0, …)`. We now persist
 * `t0Anchor` (the wall-clock t of `history[0]`) on the fitted model so
 * both forecast and update map t → days correctly.
 */

import type { TimePoint, ForecastBand, FittedModel } from '../../types.js';

export interface LogisticParams {
  readonly K: number; // carrying capacity
  readonly r: number; // growth rate (per day)
  readonly t0: number; // inflection time (days since `t0Anchor`)
  readonly lastT: number; // unix ms of the last observed point
  readonly dtMs: number; // mean inter-sample spacing in ms
  /**
   * H1 — the wall-clock timestamp of `history[0]` used as the origin of
   * the day-scale x-axis during fit. forecastArrears + updateArrears
   * need this to project forward in the SAME x-scale used by `t0`/`r`.
   * Pre-fix this was lost and `(t - t)/dayMs` collapsed every projection
   * to x=0 → the forecaster returned a flat band at `logistic(0, …)`.
   */
  readonly t0Anchor: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function logistic(t: number, K: number, r: number, t0: number): number {
  // numerically stable: clamp the exponent
  const z = Math.max(-50, Math.min(50, -r * (t - t0)));
  return K / (1 + Math.exp(z));
}

function rss(
  values: ReadonlyArray<{ x: number; y: number }>,
  K: number,
  r: number,
  t0: number,
): number {
  let s = 0;
  for (const { x, y } of values) {
    const f = logistic(x, K, r, t0);
    s += (y - f) * (y - f);
  }
  return s;
}

export function fitArrears(
  history: ReadonlyArray<TimePoint>,
): FittedModel<LogisticParams> {
  if (history.length < 3) {
    throw new Error('Need at least 3 points to fit a logistic curve');
  }
  const t0Anchor = history[0]?.t ?? 0;
  const points = history.map((p) => ({
    x: (p.t - t0Anchor) / DAY_MS,
    y: Math.max(0, p.v),
  }));

  const maxY = Math.max(...points.map((p) => p.y));
  const xs = points.map((p) => p.x);
  const lastX = xs[xs.length - 1] ?? 1;

  // Grid search
  let best = { K: maxY * 2, r: 0.1, t0: lastX / 2, score: Infinity };
  const kGrid = [maxY * 1.1, maxY * 1.5, maxY * 2, maxY * 3, maxY * 5];
  const rGrid = [0.01, 0.05, 0.1, 0.2, 0.5, 1.0];
  const tGrid = [lastX * 0.25, lastX * 0.5, lastX * 0.75, lastX, lastX * 1.5];
  for (const K of kGrid) {
    for (const r of rGrid) {
      for (const t0 of tGrid) {
        const s = rss(points, K, r, t0);
        if (s < best.score) best = { K, r, t0, score: s };
      }
    }
  }

  // Local refinement (3 rounds, halving steps)
  let { K, r, t0 } = best;
  let step = { K: K * 0.2, r: r * 0.5, t0: lastX * 0.25 };
  for (let round = 0; round < 3; round += 1) {
    const candidates = [
      { K: K + step.K, r, t0 },
      { K: K - step.K, r, t0 },
      { K, r: r + step.r, t0 },
      { K, r: Math.max(0.001, r - step.r), t0 },
      { K, r, t0: t0 + step.t0 },
      { K, r, t0: t0 - step.t0 },
    ];
    for (const c of candidates) {
      const s = rss(points, c.K, c.r, c.t0);
      if (s < best.score) {
        best = { ...c, score: s };
        K = c.K;
        r = c.r;
        t0 = c.t0;
      }
    }
    step = { K: step.K / 2, r: step.r / 2, t0: step.t0 / 2 };
  }

  // Residual std
  const residuals = points.map(
    (p) => p.y - logistic(p.x, best.K, best.r, best.t0),
  );
  const mean =
    residuals.reduce((s, x) => s + x, 0) / Math.max(1, residuals.length);
  const variance =
    residuals.reduce((s, x) => s + (x - mean) * (x - mean), 0) /
    Math.max(1, residuals.length);

  const dtMs =
    history.length >= 2 && history[1] !== undefined && history[0] !== undefined
      ? history[1].t - history[0].t
      : DAY_MS;

  return {
    params: {
      K: best.K,
      r: best.r,
      t0: best.t0,
      lastT: history[history.length - 1]?.t ?? Date.now(),
      dtMs,
      t0Anchor,
    },
    residualStd: Math.sqrt(variance),
    sampleSize: history.length,
  };
}

export function forecastArrears(
  model: FittedModel<LogisticParams>,
  horizonDays: number,
): ReadonlyArray<ForecastBand> {
  const Z = 1.2816;
  // H1 — anchor the x-axis to the SAME origin used at fit-time. `t0` is
  // measured in days-since-t0Anchor; the last observed point sits at
  // `(lastT - t0Anchor) / DAY_MS` on that axis. Each forecast horizon
  // step adds `h` days to that anchor — projections sit on the actual
  // logistic curve, not at x=0.
  const baseX = (model.params.lastT - model.params.t0Anchor) / DAY_MS;
  const out: ForecastBand[] = [];
  for (let h = 1; h <= horizonDays; h += 1) {
    const x = baseX + h;
    const p50 = logistic(x, model.params.K, model.params.r, model.params.t0);
    const sigma = model.residualStd * Math.sqrt(h);
    out.push({
      t: model.params.lastT + h * DAY_MS,
      p10: Math.max(0, p50 - Z * sigma),
      p50,
      p90: p50 + Z * sigma,
    });
  }
  return out;
}

export function updateArrears(
  model: FittedModel<LogisticParams>,
  actual: TimePoint,
): FittedModel<LogisticParams> {
  // H1 — compute the actual point's x-coordinate on the SAME day-scale
  // axis used at fit-time, not against itself. Pre-fix `(actual.t -
  // actual.t)/DAY_MS` always yielded 0 — residual was just
  // `actual.v - logistic(0, …)` regardless of how far the observation
  // landed past the last fitted point.
  const xAct = (actual.t - model.params.t0Anchor) / DAY_MS;
  const f = logistic(xAct, model.params.K, model.params.r, model.params.t0);
  const residual = actual.v - f;
  const lambda = 0.1;
  const newStd = Math.sqrt(
    (1 - lambda) * model.residualStd * model.residualStd + lambda * residual * residual,
  );
  return {
    params: { ...model.params, lastT: actual.t },
    residualStd: newStd,
    sampleSize: model.sampleSize + 1,
  };
}
