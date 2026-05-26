import { describe, expect, it } from 'vitest';
import {
  scoreRecipe,
  computeScore,
  LOCK_COMPLETION_MIN,
  IMPROVE_COMPLETION_MAX,
  IMPROVE_FIELD_ERROR_MIN,
  IMPROVE_TOOLTIP_HIT_MIN,
  SCORE_WEIGHT_COMPLETION,
  SCORE_WEIGHT_ERROR,
  SCORE_WEIGHT_ABANDONMENT,
} from '../aggregator/fitness-scorer.js';
import type { RecipeMetrics } from '../types.js';

function metrics(over: Partial<RecipeMetrics> = {}): RecipeMetrics {
  return {
    tabRecipeId: 'buyer_kyb_start',
    tabRecipeVersion: 1,
    windowStartIso: '2026-04-01T00:00:00.000Z',
    windowEndIso: '2026-05-01T00:00:00.000Z',
    renderCount: 100,
    submitCount: 90,
    completionRate: 0.9,
    errorRate: 0.02,
    maxFieldAbandonmentRate: 0.05,
    fields: [
      {
        fieldId: 'tin_number',
        focusCount: 100,
        errorCount: 2,
        blurWithoutSubmitCount: 5,
        tooltipHitCount: 1,
        errorRate: 0.02,
        abandonmentRate: 0.05,
        tooltipHitRate: 0.01,
      },
    ],
    ...over,
  };
}

describe('computeScore', () => {
  it('weights completion the most heavily (0.6)', () => {
    const m = metrics({
      completionRate: 1.0,
      errorRate: 0,
      maxFieldAbandonmentRate: 0,
    });
    expect(computeScore(m)).toBeCloseTo(1.0, 3);
  });

  it('clamps inputs into [0..1]', () => {
    const m = metrics({
      completionRate: 1.5,
      errorRate: -0.2,
      maxFieldAbandonmentRate: 2.0,
    });
    const v = computeScore(m);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('weights sum to 1.0 (sanity)', () => {
    expect(
      SCORE_WEIGHT_COMPLETION + SCORE_WEIGHT_ERROR + SCORE_WEIGHT_ABANDONMENT,
    ).toBeCloseTo(1.0, 6);
  });

  it('zero completion + zero abandonment + zero error → 0.25 + 0.15 = 0.4', () => {
    const m = metrics({
      completionRate: 0,
      errorRate: 0,
      maxFieldAbandonmentRate: 0,
    });
    // 0.6 * 0 + 0.25 * (1-0) + 0.15 * (1-0) = 0.4
    expect(computeScore(m)).toBeCloseTo(0.4, 3);
  });
});

describe('scoreRecipe — neutral / improve / lock decisions', () => {
  it('neutral when render count below minRendersForDecision', () => {
    const r = scoreRecipe(metrics({ renderCount: 3 }));
    expect(r.decision).toBe('neutral');
  });

  it('lock_candidate when all three thresholds pass', () => {
    const r = scoreRecipe(
      metrics({
        renderCount: 100,
        submitCount: 90,
        completionRate: 0.9,
        errorRate: 0.02,
        maxFieldAbandonmentRate: 0.05,
        fields: [
          {
            fieldId: 'tin_number',
            focusCount: 100,
            errorCount: 2,
            blurWithoutSubmitCount: 5,
            tooltipHitCount: 1,
            errorRate: 0.02,
            abandonmentRate: 0.05,
            tooltipHitRate: 0.01,
          },
        ],
      }),
    );
    expect(r.decision).toBe('lock_candidate');
    expect(r.passingSignals.length).toBeGreaterThan(0);
  });

  it('improve_candidate when completion < 50%', () => {
    const r = scoreRecipe(
      metrics({
        renderCount: 100,
        submitCount: 40,
        completionRate: 0.4,
        errorRate: 0.01,
        maxFieldAbandonmentRate: 0.05,
      }),
    );
    expect(r.decision).toBe('improve_candidate');
    expect(r.failingSignals.some((s) => s.kind === 'low_completion')).toBe(true);
  });

  it('improve_candidate when a single field has error > 15%', () => {
    const r = scoreRecipe(
      metrics({
        renderCount: 100,
        submitCount: 70,
        completionRate: 0.7,
        errorRate: 0.2,
        maxFieldAbandonmentRate: 0.05,
        fields: [
          {
            fieldId: 'tin_number',
            focusCount: 100,
            errorCount: 20,
            blurWithoutSubmitCount: 5,
            tooltipHitCount: 1,
            errorRate: 0.2,
            abandonmentRate: 0.05,
            tooltipHitRate: 0.01,
          },
        ],
      }),
    );
    expect(r.decision).toBe('improve_candidate');
    expect(
      r.failingSignals.some(
        (s) => s.kind === 'high_field_error' && s.fieldId === 'tin_number',
      ),
    ).toBe(true);
  });

  it('improve_candidate when a single field has tooltip hit > 40%', () => {
    const r = scoreRecipe(
      metrics({
        renderCount: 100,
        submitCount: 80,
        completionRate: 0.8,
        errorRate: 0.01,
        maxFieldAbandonmentRate: 0.05,
        fields: [
          {
            fieldId: 'opaque_field',
            focusCount: 100,
            errorCount: 1,
            blurWithoutSubmitCount: 2,
            tooltipHitCount: 60,
            errorRate: 0.01,
            abandonmentRate: 0.02,
            tooltipHitRate: 0.6,
          },
        ],
      }),
    );
    expect(r.decision).toBe('improve_candidate');
    expect(
      r.failingSignals.some(
        (s) => s.kind === 'high_tooltip_hit' && s.fieldId === 'opaque_field',
      ),
    ).toBe(true);
  });

  it('neutral when neither lock nor improve thresholds match (middle band)', () => {
    const r = scoreRecipe(
      metrics({
        renderCount: 100,
        submitCount: 65,
        completionRate: 0.65,
        errorRate: 0.06, // > 0.05 so lock fails, < 0.15 so improve doesn't fire
        maxFieldAbandonmentRate: 0.08,
        fields: [
          {
            fieldId: 'a',
            focusCount: 100,
            errorCount: 6,
            blurWithoutSubmitCount: 8,
            tooltipHitCount: 5,
            errorRate: 0.06,
            abandonmentRate: 0.08,
            tooltipHitRate: 0.05,
          },
        ],
      }),
    );
    expect(r.decision).toBe('neutral');
  });

  it('threshold edge — completion exactly 0.80 is NOT a lock candidate', () => {
    const r = scoreRecipe(
      metrics({
        renderCount: 100,
        submitCount: 80,
        completionRate: LOCK_COMPLETION_MIN,
        errorRate: 0.0,
        maxFieldAbandonmentRate: 0.0,
        fields: [
          {
            fieldId: 'f',
            focusCount: 100,
            errorCount: 0,
            blurWithoutSubmitCount: 0,
            tooltipHitCount: 0,
            errorRate: 0,
            abandonmentRate: 0,
            tooltipHitRate: 0,
          },
        ],
      }),
    );
    // spec says > 0.80 — strictly greater than. 0.80 exactly is NOT lock.
    expect(r.decision).not.toBe('lock_candidate');
  });

  it('threshold edge — completion exactly 0.50 does NOT fire improve', () => {
    const r = scoreRecipe(
      metrics({
        renderCount: 100,
        submitCount: 50,
        completionRate: IMPROVE_COMPLETION_MAX,
        errorRate: 0.01,
        maxFieldAbandonmentRate: 0.01,
      }),
    );
    expect(
      r.failingSignals.find((s) => s.kind === 'low_completion'),
    ).toBeUndefined();
  });

  it('threshold edge — improve-field-error fires above 0.15 strictly', () => {
    const justOver = scoreRecipe(
      metrics({
        renderCount: 100,
        submitCount: 70,
        completionRate: 0.7,
        errorRate: 0.16,
        fields: [
          {
            fieldId: 'f',
            focusCount: 100,
            errorCount: 16,
            blurWithoutSubmitCount: 0,
            tooltipHitCount: 0,
            errorRate: 0.16,
            abandonmentRate: 0,
            tooltipHitRate: 0,
          },
        ],
      }),
    );
    expect(
      justOver.failingSignals.some((s) => s.kind === 'high_field_error'),
    ).toBe(true);

    const exactly = scoreRecipe(
      metrics({
        renderCount: 100,
        submitCount: 70,
        completionRate: 0.7,
        errorRate: IMPROVE_FIELD_ERROR_MIN,
        fields: [
          {
            fieldId: 'f',
            focusCount: 100,
            errorCount: 15,
            blurWithoutSubmitCount: 0,
            tooltipHitCount: 0,
            errorRate: IMPROVE_FIELD_ERROR_MIN,
            abandonmentRate: 0,
            tooltipHitRate: 0,
          },
        ],
      }),
    );
    expect(
      exactly.failingSignals.some((s) => s.kind === 'high_field_error'),
    ).toBe(false);
  });

  it('threshold edge — tooltip-hit fires above 0.40 strictly', () => {
    const r = scoreRecipe(
      metrics({
        renderCount: 100,
        submitCount: 70,
        completionRate: 0.7,
        errorRate: 0.01,
        fields: [
          {
            fieldId: 'f',
            focusCount: 100,
            errorCount: 1,
            blurWithoutSubmitCount: 0,
            tooltipHitCount: 41,
            errorRate: 0.01,
            abandonmentRate: 0,
            tooltipHitRate: 0.41,
          },
        ],
      }),
    );
    expect(
      r.failingSignals.some(
        (s) => s.kind === 'high_tooltip_hit' && s.value > IMPROVE_TOOLTIP_HIT_MIN,
      ),
    ).toBe(true);
  });

  it('high abandonment surfaces as a failing signal', () => {
    const r = scoreRecipe(
      metrics({
        renderCount: 100,
        submitCount: 60,
        completionRate: 0.6,
        errorRate: 0.01,
        maxFieldAbandonmentRate: 0.3,
        fields: [
          {
            fieldId: 'f',
            focusCount: 100,
            errorCount: 1,
            blurWithoutSubmitCount: 30,
            tooltipHitCount: 1,
            errorRate: 0.01,
            abandonmentRate: 0.3,
            tooltipHitRate: 0.01,
          },
        ],
      }),
    );
    expect(
      r.failingSignals.some((s) => s.kind === 'high_field_abandonment'),
    ).toBe(true);
  });

  it('empty-field recipes never become lock candidates', () => {
    const r = scoreRecipe(
      metrics({
        renderCount: 100,
        submitCount: 95,
        completionRate: 0.95,
        errorRate: 0,
        maxFieldAbandonmentRate: 0,
        fields: [],
      }),
    );
    expect(r.decision).toBe('neutral');
  });
});
